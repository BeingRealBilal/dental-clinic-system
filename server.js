const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 1. SETUP WHATSAPP ---
console.log("🔄 Starting WhatsApp Client...");
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ WhatsApp Bot is Ready!'));
client.initialize();

// --- 2. CONFIGURATION ---
app.use(express.static(path.join(__dirname, 'public')));
const DOCTOR_NUMBER = "923001234567"; // <--- CHANGE THIS
const ADMIN_PASSWORD = "ravi";          // <--- YOUR DASHBOARD PASSWORD

let appointments = []; // Store bookings in memory

// Helper: Fix phone numbers
function sanitizeNumber(number) {
    let clean = number.replace(/[^0-9]/g, '');
    if (clean.startsWith('0')) clean = '92' + clean.substring(1);
    return clean;
}

// --- 3. SOCKET LOGIC ---
io.on('connection', (socket) => {
    
    // A. LOGIN LOGIC (For Admin Dashboard)
    socket.on('admin_login', (password) => {
        if (password === ADMIN_PASSWORD) {
            socket.join('admin_room'); // Add this connection to the VIP room
            socket.emit('login_success', appointments); // Send current list
        } else {
            socket.emit('login_fail');
        }
    });

    // B. NEW BOOKING (From Patient)
    socket.on('new_booking', (data) => {
        console.log('📅 New Request:', data.name);
        data.id = Date.now();
        data.status = 'pending';
        appointments.push(data);
        
        // Only send this alert to the ADMIN ROOM (Doctor), not other patients
        io.to('admin_room').emit('new_request', data);
    });

    // C. APPROVE (Triggers WhatsApp)
    socket.on('approve_booking', async (id) => {
        const appt = appointments.find(a => a.id === id);
        if (!appt) return;

        console.log(`✅ Approving ${appt.name}`);
        
        // Remove from pending list
        appointments = appointments.filter(a => a.id !== id);
        // Update Admin Screens
        io.to('admin_room').emit('update_list', appointments);

        // SEND WHATSAPP NOW
        try {
            const doctorID = `${sanitizeNumber(DOCTOR_NUMBER)}@c.us`;
            const patientID = `${sanitizeNumber(appt.phone)}@c.us`;

            const msgPatient = `✅ *Booking Confirmed*\n\nHello ${appt.name}, your appointment for *${appt.service}* is approved for *${appt.time}*.\n\nSee you soon!`;
            const msgDoctor = `🔔 *New Appointment*\n\n👤 ${appt.name}\n📞 ${appt.phone}\n🏥 ${appt.service}\n🕒 ${appt.time}`;

            const isRegistered = await client.isRegisteredUser(patientID);
            if (isRegistered) await client.sendMessage(patientID, msgPatient);
            
            await client.sendMessage(doctorID, msgDoctor);

        } catch (err) {
            console.log('❌ WhatsApp Error:', err.message);
        }
    });

    // D. REJECT (Delete)
    socket.on('reject_booking', (id) => {
        console.log(`❌ Rejecting ID ${id}`);
        appointments = appointments.filter(a => a.id !== id);
        io.to('admin_room').emit('update_list', appointments);
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`🔒 Secure Server running on port ${PORT}`));