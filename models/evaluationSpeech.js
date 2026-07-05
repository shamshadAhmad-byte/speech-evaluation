import mongoose from 'mongoose';

const speechSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    transcript: {
        type: String,
        required: true
    },
    evaluationResult: {
        type: Object,
        required: true
    }
}, { timestamps: true });
export const Speech = mongoose.model("Speech", speechSchema);