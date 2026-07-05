import mongoose from "mongoose";

let cachedConnection = null;

export const connectDB = async () => {
    if (cachedConnection) {
        return cachedConnection;
    }

    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is not set");
    }

    cachedConnection = await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected successfully");
    return cachedConnection;
};