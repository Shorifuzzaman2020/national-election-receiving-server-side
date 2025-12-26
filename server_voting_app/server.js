

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
const voters = db.collection("voters");


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




// Voter Login - Send verification code
app.post("/api/voter/send-code", async (req, res) => {
    try {
        const { voterId } = req.body;

        if (!voterId) {
            return res.status(400).json({
                success: false,
                message: "Voter ID is required"
            });
        }

        // Find voter by voter ID
        const voter = await db.collection("voters").findOne({ voterId });
        
        if (!voter) {
            return res.status(404).json({
                success: false,
                message: "Voter not found"
            });
        }

        // Generate 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();

        // Store code with expiration (5 minutes)
        await db.collection("voterCodes").updateOne(
            { voterId },
            { 
                $set: { 
                    code, 
                    createdAt: new Date(),
                    expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
                } 
            },
            { upsert: true }
        );

        // Send code to voter's email
        await transporter.sendMail({
            from: `"Election System" <${process.env.SYSTEM_EMAIL}>`,
            to: voter.email,
            subject: "Voter Login Verification Code",
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #1a56db;">Election System Login Code</h2>
                    <p>Hello ${voter.name},</p>
                    <p>Your login verification code is:</p>
                    <div style="background-color: #f3f4f6; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; margin: 20px 0;">
                        ${code}
                    </div>
                    <p>This code will expire in 5 minutes.</p>
                    <p>If you didn't request this code, please ignore this email.</p>
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                    <p style="color: #6b7280; font-size: 12px;">
                        This is an automated message from the Election System.
                    </p>
                </div>
            `
        });

        res.json({
            success: true,
            message: "Verification code sent to your email",
            emailMasked: voter.email.replace(/(.{2}).*@/, "$1****@") // Mask email for security
        });

    } catch (error) {
        console.error("Send code error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to send verification code"
        });
    }
});

// Voter Login - Verify code
app.post("/api/voter/login", async (req, res) => {
    try {
        const { voterId, code } = req.body;

        if (!voterId || !code) {
            return res.status(400).json({
                success: false,
                message: "Voter ID and code are required"
            });
        }

        // Find voter
        const voter = await db.collection("voters").findOne({ voterId });
        
        if (!voter) {
            return res.status(404).json({
                success: false,
                message: "Voter not found"
            });
        }

        // Check if voter is active
        if (voter.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: "Voter account is not active"
            });
        }

        // Find and verify code
        const codeRecord = await db.collection("voterCodes").findOne({ voterId });
        
        if (!codeRecord) {
            return res.status(400).json({
                success: false,
                message: "No verification code found. Please request a new code."
            });
        }

        // Check if code has expired
        if (new Date() > new Date(codeRecord.expiresAt)) {
            return res.status(400).json({
                success: false,
                message: "Verification code has expired. Please request a new code."
            });
        }

        // Verify code
        if (codeRecord.code !== code) {
            return res.status(401).json({
                success: false,
                message: "Invalid verification code"
            });
        }

        // Check if voter has already voted
        const hasVoted = await db.collection("votes").findOne({ voterId });
        
        // Get current election status
        const election = await db.collection("elections").findOne({ type: "current" });
        
        // Create JWT token
        const token = jwt.sign(
            {
                voterId: voter.voterId,
                email: voter.email,
                name: voter.name,
                hasVoted: !!hasVoted,
                electionOpen: election?.votingOpen || false,
                electionFinished: election?.finished || false
            },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        // Delete used code
        await db.collection("voterCodes").deleteOne({ voterId });

        res.json({
            success: true,
            token,
            voter: {
                name: voter.name,
                voterId: voter.voterId,
                email: voter.email,
                district: voter.district,
                hasVoted: !!hasVoted
            },
            election: {
                votingOpen: election?.votingOpen || false,
                finished: election?.finished || false
            }
        });

    } catch (error) {
        console.error("Voter login error:", error);
        res.status(500).json({
            success: false,
            message: "Login failed"
        });
    }
});







app.get("/api/voter/candidates", async (req, res) => {
    const election = await elections.findOne({ type: "current" });

    if (election.votingStatus !== "Started") {
        return res.send({ success: true, candidates: [] });
    }

    const candidates = await nominations.find({ status: "Approved" }).toArray();

    res.send({ success: true, candidates });
});




app.post("/api/voter/vote", async (req, res) => {
    try {
        const { voterId, nominationId } = req.body;

        const election = await elections.findOne({ type: "current" });

        if (!election || election.votingStatus !== "Started") {
            return res.status(403).send({ message: "Voting is not active" });
        }

        const voter = await voters.findOne({ voterId });
        if (!voter) return res.status(404).send({ message: "Voter not found" });

        if (voter.hasVoted) {
            return res.status(400).send({ message: "You already voted" });
        }

        // 🔍 Find candidate by nominationId
        const candidate = await nominations.findOne({ nominationId });
        if (!candidate) return res.status(404).send({ message: "Candidate not found" });

        // 🗳️ Add vote
        await nominations.updateOne(
            { nominationId },
            { $inc: { votes: 1 } }
        );

        // 🔒 Lock voter
        await voters.updateOne(
            { voterId },
            { $set: { hasVoted: true, votedAt: new Date() } }
        );

        res.send({ success: true, message: "Vote recorded" });

    } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Voting failed" });
    }
});



app.get("/api/voter/results", async (req, res) => {
    const election = await elections.findOne({ type: "current" });

    if (election.votingStatus !== "Ended") {
        return res.send({ success: false, message: "Results not available" });
    }

    const results = await nominations
        .find({ status: "Approved" })
        .sort({ votes: -1 })
        .toArray();

    res.send({ success: true, results });
});


app.post("/api/admin/start-voting", async (req, res) => {
    try {
        await db.collection("elections").updateOne(
            { type: "current" },
            { 
                $set: { 
                    votingOpen: true,
                    finished: false,
                    votingStatus: "Started",  // Add this for consistency
                    votingStartedAt: new Date()
                } 
            },
            { upsert: true }
        );

        res.json({
            success: true,
            message: "Voting started successfully"
        });

    } catch (error) {
        console.error("Start voting error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to start voting"
        });
    }
});

app.post("/api/admin/end-voting", async (req, res) => {
    try {
        await db.collection("elections").updateOne(
            { type: "current" },
            { 
                $set: { 
                    votingOpen: false,
                    finished: true,
                    votingStatus: "Ended",  // Add this for consistency
                    votingEndedAt: new Date()
                } 
            }
        );

        res.json({
            success: true,
            message: "Voting ended successfully"
        });

    } catch (error) {
        console.error("End voting error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to end voting"
        });
    }
});


// Add this to your backend (app.js)
app.get("/api/election/status", async (req, res) => {
    try {
        const election = await db.collection("elections").findOne({ type: "current" });
        
        if (!election) {
            return res.json({
                success: true,
                votingStatus: "NOT_STARTED",
                votingOpen: false,
                finished: false
            });
        }

        // Determine voting status based on your schema
        let votingStatus = "NOT_STARTED";
        if (election.finished) {
            votingStatus = "Ended";
        } else if (election.votingOpen) {
            votingStatus = "Started";
        }

        res.json({
            success: true,
            votingStatus,
            votingOpen: election.votingOpen || false,
            finished: election.finished || false,
            votingStartedAt: election.votingStartedAt,
            votingEndedAt: election.votingEndedAt
        });

    } catch (error) {
        console.error("Get election status error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to get election status"
        });
    }
});



// Middleware to authenticate voter
function authenticateVoter(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Access token required" });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, voter) => {
        if (err) {
            return res.status(403).json({ message: "Invalid or expired token" });
        }
        req.voter = voter;
        next();
    });
}

// Get voter profile
app.get("/api/voter/profile", authenticateVoter, async (req, res) => {
    try {
        const voter = await db.collection("voters").findOne({ voterId: req.voter.voterId });
        
        if (!voter) {
            return res.status(404).json({
                success: false,
                message: "Voter not found"
            });
        }

        const hasVoted = await db.collection("votes").findOne({ voterId: voter.voterId });
        const election = await db.collection("elections").findOne({ type: "current" });

        res.json({
            success: true,
            voter: {
                name: voter.name,
                voterId: voter.voterId,
                email: voter.email,
                district: voter.district,
                phone: voter.phone,
                dob: voter.dob,
                bloodGroup: voter.bloodGroup
            },
            votingStatus: {
                hasVoted: !!hasVoted,
                votingOpen: election?.votingOpen || false,
                electionFinished: election?.finished || false,
                lastVotedAt: hasVoted?.votedAt
            }
        });

    } catch (error) {
        console.error("Get profile error:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch profile"
        });
    }
});












app.post("/candidate/send-code", async (req, res) => {
    const { email } = req.body;

    const candidate = await nominations.findOne({ email });
    if (!candidate) {
        return res.status(403).send({ error: "You are not a candidate" });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await adminCodes.updateOne(
        { email },
        { $set: { code, createdAt: new Date() } },
        { upsert: true }
    );

    await transporter.sendMail({
        to: email,
        subject: "Candidate Login Code",
        html: `<h2>Your Login Code</h2><h1>${code}</h1>`
    });

    res.send({ success: true });
});


app.post("/candidate/login", async (req, res) => {
    const { email, code } = req.body;

    const candidate = await nominations.findOne({ email });
    if (!candidate) return res.status(403).send({ error: "You are not a candidate" });

    const record = await adminCodes.findOne({ email });
    if (!record || record.code !== code)
        return res.status(401).send({ error: "Invalid code" });

    const token = jwt.sign(
        { id: candidate._id, role: "candidate" },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
    );

    res.send({
        success: true,
        token,
        nominationId: candidate.nominationId
    });
});


app.get("/candidate/profile", async (req, res) => {
    try {
        const auth = req.headers.authorization;
        if (!auth) return res.status(401).send({ error: "Unauthorized" });

        const token = auth.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== "candidate") {
            return res.status(403).send({ error: "Forbidden" });
        }

        const nomination = await nominations.findOne({ _id: new ObjectId(decoded.id) });

        if (!nomination) {
            return res.status(404).send({ error: "Candidate not found" });
        }

        res.send({
            candidate: {
                name: nomination.name,
                email: nomination.email,
            },
            nomination: {
                nominationId: nomination.nominationId,
            
                symbol: nomination.sign,
                status: nomination.status,
                createdAt: nomination.createdAt
            }
        });
    } catch (err) {
        console.error(err);
        res.status(401).send({ error: "Invalid token" });
    }
});


// Middleware for authentication
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Access token required" });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: "Invalid or expired token" });
        }
        req.user = user;
        next();
    });
}



// Add this endpoint to your backend
app.post("/subadmin/voters", async (req, res) => {
  try {
    const {
      name, voterId, email, phone,
      dob, district, upazila, union, bloodGroup, age
    } = req.body;

    // Validation
    if (!name || !voterId || !email || !phone || !dob || !district || !upazila || !union || !bloodGroup) {
      return res.status(400).json({ 
        success: false, 
        message: "All fields are required" 
      });
    }

    // Age validation (also validate on backend)
    const birthDate = new Date(dob);
    const today = new Date();
    let calculatedAge = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      calculatedAge--;
    }

    if (calculatedAge < 18) {
      return res.status(400).json({ 
        success: false, 
        message: "Voter must be at least 18 years old" 
      });
    }

    // Check for duplicate voter
    const existingVoter = await db.collection("voters").findOne({
      $or: [
        { voterId },
        { email },
        { phone }
      ]
    });

    if (existingVoter) {
      return res.status(400).json({ 
        success: false, 
        message: "Voter already exists with this ID/email/phone" 
      });
    }

    // Create voter
    const newVoter = await db.collection("voters").insertOne({
      name,
      voterId,
      email,
      phone,
      dob: new Date(dob),
      age: calculatedAge,
      district,
      upazila,
      union,
      bloodGroup,
      status: "active",
      registeredAt: new Date(),
      updatedAt: new Date()
    });

    res.status(201).json({
      success: true,
      message: "Voter registered successfully",
      voterId: voterId
    });

  } catch (error) {
    console.error("Add voter error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to add voter" 
    });
  }
});



// Get all voters
app.get("/subadmin/voters", async (req, res) => {
    try {
        const voters = await db.collection("voters").find().sort({ createdAt: -1 }).toArray();
        res.json(voters);
    } catch (error) {
        console.error("Error fetching voters:", error);
        res.status(500).json({ message: "Failed to fetch voters" });
    }
});

// Delete voter
app.delete("/subadmin/voters/:id", async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.collection("voters").deleteOne({ 
            _id: new ObjectId(id) 
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "Voter not found" 
            });
        }

        res.json({ 
            success: true, 
            message: "Voter deleted successfully" 
        });

    } catch (error) {
        console.error("Delete voter error:", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to delete voter" 
        });
    }
});

// Update voter
app.put("/subadmin/voters/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        // Remove empty fields
        Object.keys(updateData).forEach(key => {
            if (updateData[key] === "" || updateData[key] === null) {
                delete updateData[key];
            }
        });

        // Add updated timestamp
        updateData.updatedAt = new Date();

        const result = await db.collection("voters").updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: "Voter not found" 
            });
        }

        res.json({ 
            success: true, 
            message: "Voter updated successfully" 
        });

    } catch (error) {
        console.error("Update voter error:", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to update voter" 
        });
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
            votes: 0,
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



app.post("/admin/start-voting", async (req, res) => {
    await elections.updateOne(
        { type: "current" },
        { $set: { votingStatus: "Started" } },
        { upsert: true }
    );
    res.send({ success: true });
});

app.post("/admin/end-voting", async (req, res) => {
    await elections.updateOne(
        { type: "current" },
        { $set: { votingStatus: "Ended" } }
    );
    res.send({ success: true });
});



app.get("/api/voter/profile", async (req, res) => {
  const voter = await voters.findOne({ _id: req.voter.id });
  const election = await elections.findOne({ type: "current" });

  const hasVoted = await votes.findOne({ voterId: voter.voterId });

  res.send({
    success: true,
    voter,
    votingStatus: {
      status: election?.votingStatus || "NOT_STARTED",
      hasVoted: !!hasVoted
    }
  });
});


app.get("/api/voter/candidates", async (req, res) => {
  const election = await elections.findOne({ type: "current" });

  if (election.votingStatus !== "Started") {
    return res.send({ success: true, candidates: [] });
  }

  const candidates = await nominations.find({ status: "Approved" }).toArray();

  res.send({ success: true, candidates });
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
