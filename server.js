import "dotenv/config";
import express from "express";
import {evaluateSpeech} from "./utils/evaluateSpeech.js"; 
import {evaluateLimiter} from "./middleware/rateLimiter.js";
const app=express();
const port=3000;

app.use(express.json());
app.use(express.urlencoded({extended: true}))
app.use(express.static("public"))

app.get("/",async(req,res)=>{
    res.sendFile(process.cwd() + "/public/speakEvaluation.html");
});

app.post("/api/evaluate-speech",evaluateLimiter,async(req,res)=>{
    const { transcript, text } = req.body;
    const input = transcript ?? text ?? "";
    const result = await evaluateSpeech(input);
    res.json(result);
})

app.listen(port,()=>{
    console.log(`Server is running on port ${port}`);
});