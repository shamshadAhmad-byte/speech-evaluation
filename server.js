import "dotenv/config";
import express from "express";
import {evaluateSpeech} from "./utils/evaluateSpeech.js"; 
import {evaluateLimiter} from "./middleware/rateLimiter.js";
import { connectDB } from "./config/db.js";
import { User } from "./models/userModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { authenticate } from "./middleware/auth.js";
import { Speech } from "./models/evaluationSpeech.js";
const app=express();
const port=3000;

await connectDB();

app.use(express.json());
app.use(express.urlencoded({extended: true}))
app.use(express.static("public"))

app.get("/",async(req,res)=>{
    res.sendFile(process.cwd() + "/public/login.html");
});
app.get("/speak-evaluation",async(req,res)=>{
    res.sendFile(process.cwd() + "/public/speakEvaluation.html");
});

app.post("/api/evaluate-speech",evaluateLimiter,authenticate,async(req,res)=>{
    console.log("Received request to evaluate speech");
    const { transcript, text } = req.body;
    const userId = req.user.userId; // Get user ID from the authenticated request
    const input = transcript ?? text ?? "";
    const result = await evaluateSpeech(input);
    const speechEvaluation = new Speech({
        userId: userId,
        transcript: transcript,
        evaluationResult: result
    });
    await speechEvaluation.save();

    res.json(result);
})

app.post("/register",async(req,res)=>{
    const { name,email, password } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email already exists" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ name,email, password: hashedPassword });
        await user.save();
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
        res.status(201).json({ message: "User registered successfully", token });
    }
    catch (error) {
        res.status(500).json({ message: "Error registering user", error: error.message });
    }
});

app.post("/login",async(req,res)=>{
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: "Invalid email or password" });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: "Invalid email or password" });
        }
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
        res.json({ message: "Login successful", token });
    }
    catch (error) {
        res.status(500).json({ message: "Error logging in", error: error.message });
    }
});

app.listen(port,()=>{
    console.log(`Server is running on port ${port}`);
});