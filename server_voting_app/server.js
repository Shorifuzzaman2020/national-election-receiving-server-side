

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// MongoDB
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dzmpelq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri);

// Connect DB
async function start() {
    await client.connect();
    console.log("MongoDB Connected");
    app.listen(port, () => console.log("Server running on", port));
}
start();


const db = client.db("electionSystem");
const users = db.collection("users");
const elections = db.collection("elections");
const nominations = db.collection("nominations");
const votes = db.collection("votes");
const adminCodes = db.collection("adminCodes");
const payments = db.collection("payments");
const subAdmins = db.collection("subAdmins");

const SSLCommerzPayment = require("sslcommerz-lts");

// JWT
function createToken(user) {
    return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
        expiresIn: "7d",
    });
}

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.SYSTEM_EMAIL,
        pass: process.env.SYSTEM_EMAIL_PASS
    }
});




app.post("/api/admin/create-sub-admin", async (req, res) => {
    try {
        // ✅ MUST come first
        const { adminId, name, email, password, phone } = req.body;

        if (!adminId || !name || !email || !password || !phone) {
            return res.status(400).json({ message: "All fields are required" });
        }

        const existing = await subAdmins.findOne({ email });
        if (existing) {
            return res.status(400).json({ message: "Sub Admin already exists" });
        }

        const hashed = await bcrypt.hash(password, 10);

        await subAdmins.insertOne({
            adminId,
            name,
            email,
            phone,
            password: hashed,
            role: "subadmin",
            createdAt: new Date()
        });

        res.status(201).json({ message: "Sub Admin created successfully" });

    } catch (error) {
        console.error("Create Sub Admin Error:", error);
        res.status(500).json({ message: "Server error" });
    }
});



app.post("/subadmin/send-code", async (req, res) => {
    const { phone } = req.body;

    const subadmin = await subAdmins.findOne({ phone });
    if (!subadmin) return res.status(404).send({ error: "Sub Admin not found" });

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await adminCodes.updateOne(
        { phone },
        { $set: { code, createdAt: new Date() } },
        { upsert: true }
    );

    // (For now we simulate SMS by sending to email)
    await transporter.sendMail({
        to: subadmin.email,
        subject: "Sub Admin Login Code",
        html: `<h1>${code}</h1>`
    });

    res.send({ message: "Code sent" });
});




app.post("/subadmin/login", async (req, res) => {
    const { phone, password, code } = req.body;

    const subadmin = await subAdmins.findOne({ phone });
    if (!subadmin) return res.status(404).send({ error: "Sub Admin not found" });

    const validPass = await bcrypt.compare(password, subadmin.password);
    if (!validPass) return res.status(401).send({ error: "Invalid password" });

    const record = await adminCodes.findOne({ phone });
    if (!record || record.code !== code)
        return res.status(401).send({ error: "Invalid code" });

    const token = jwt.sign(
        { id: subadmin._id, role: "subadmin" },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
    );

    res.send({ success: true, token });
});




//Nomination Payment Initiation
app.post("/payment/initiate", async (req, res) => {
    const { name, email } = req.body;

    const transactionId = "TXN_" + Date.now();

    const data = {
        total_amount: 500,
        currency: "BDT",
        tran_id: transactionId,
        success_url: "http://localhost:5000/payment/success",
        fail_url: "http://localhost:5000/payment/fail",
        cancel_url: "http://localhost:5000/payment/cancel",
        ipn_url: "http://localhost:5000/payment/ipn",
        shipping_method: "NO",
        product_name: "Nomination Fee",
        product_category: "Election",
        product_profile: "general",
        cus_name: name,
        cus_email: email,
        cus_add1: "Bangladesh",
        cus_city: "Dhaka",
        cus_country: "Bangladesh",
        cus_phone: "01700000000"
    };

    const sslcz = new SSLCommerzPayment(
        process.env.SSL_STORE_ID,
        process.env.SSL_STORE_PASS,
        process.env.SSL_IS_LIVE === "true"
    );

    const apiResponse = await sslcz.init(data);

    res.send({ url: apiResponse.GatewayPageURL, transactionId });
});




app.post("/payment/success", async (req, res) => {
    try {
        const transactionId = req.body.tran_id;

        if (!transactionId) {
            console.error("SSLCommerz Response:", req.body);
            return res.status(400).send("Invalid payment response");
        }

        await payments.insertOne({
            transactionId,
            status: "PAID",
            createdAt: new Date(),
            raw: req.body
        });

        res.redirect("http://localhost:5173/payment-success");
    } catch (error) {
        console.error("Payment Success Error:", error);
        res.status(500).send("Payment processing failed");
    }
});






app.post("/nominate", async (req, res) => {
    try {
        const nominationId = "NOM-" + Date.now();

        const result = await nominations.insertOne({
            ...req.body,
            nominationId,
            createdAt: new Date()
        });

        res.send({
            success: true,
            nominationId
        });
    } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Nomination failed" });
    }
});




app.post("/payment/fail", (req, res) => {
    res.redirect("http://localhost:5173/payment-failed");
});

app.post("/payment/cancel", (req, res) => {
    res.redirect("http://localhost:5173/payment-cancelled");
});

app.get("/admin/nominations", async (req, res) => {
    const list = await nominations.find().toArray();
    res.send(list);
});

app.patch("/admin/nominations/:id", async (req, res) => {
    const { status } = req.body;
    await nominations.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status } }
    );
    res.send({ success: true });
});



app.post("/admin/send-code", async (req, res) => {
    try {
        const { email } = req.body;

        const code = Math.floor(100000 + Math.random() * 900000).toString();

        await adminCodes.updateOne(
            { email },
            { $set: { code, createdAt: new Date() } },
            { upsert: true }
        );

        await transporter.sendMail({
            from: `"Election System" <${process.env.SYSTEM_EMAIL}>`,
            to: email,
            subject: "Admin Login Verification Code",
            html: `<h2>Your Login Code</h2><h1>${code}</h1><p>Valid for 5 minutes</p>`
        });

        res.send({ message: "Code sent successfully" });

    } catch (error) {
        console.error("Send Code Error:", error);
        res.status(500).send({ error: "Failed to send email" });
    }
});




app.post("/admin/verify-code", async (req, res) => {
    const { email, code } = req.body;

    const record = await adminCodes.findOne({ email });

    if (!record || record.code !== code)
        return res.status(401).send({ error: "Invalid code" });

    if (record.role !== "admin")
        return res.status(403).send({ error: "Not an admin account" });

    const token = jwt.sign(
        { id: record._id, role: record.role },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
    );

    res.send({
        success: true,
        role: record.role,   // ✅ fixed
        token
    });
});


app.post("/admin/publish", async (req, res) => {
    await elections.updateOne(
        { type: "current" },
        { $set: { nominationOpen: true } },
        { upsert: true }
    );
    res.send({ message: "Nomination Published" });
});

app.post("/admin/unpublish", async (req, res) => {
    await elections.updateOne(
        { type: "current" },
        { $set: { nominationOpen: false } }
    );
    res.send({ message: "Nomination Closed" });
});

app.get("/election/status", async (req, res) => {
    const election = await elections.findOne({ type: "current" });
    res.send({ nominationOpen: election?.nominationOpen || false });
});



// Admin - Publish Nomination
app.post("/admin/publish", async (req, res) => {
    await elections.updateOne(
        { type: "current" },
        { $set: { nominationOpen: true } },
        { upsert: true }
    );
    res.send({ message: "Nomination Published" });
});

// Admin - Unpublish Nomination
app.post("/admin/unpublish", async (req, res) => {
    await elections.updateOne({ type: "current" }, { $set: { nominationOpen: false } });
    res.send({ message: "Nomination Closed" });
});



// Admin - View Nominations
app.get("/admin/nominations", async (req, res) => {
    const data = await nominations.find().toArray();
    res.send(data);
});

// Admin - Approve/Reject
app.patch("/admin/nominations/:id", async (req, res) => {
    await nominations.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: req.body.status } }
    );
    res.send({ message: "Status Updated" });
});

// Vote
app.post("/vote", async (req, res) => {
    await votes.insertOne(req.body);
    res.send({ message: "Vote Recorded" });
});

// Result
app.get("/results", async (req, res) => {
    const result = await votes
        .aggregate([{ $group: { _id: "$candidate", total: { $sum: 1 } } }])
        .toArray();
    res.send(result);
});

// Home
app.get("/", (req, res) => {
    res.send("Online Election System API");
});
