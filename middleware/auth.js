import jwt from "jsonwebtoken";

export const authenticate = (req, res, next) => {

    const authorization = req.headers.authorization || "";
    if (!authorization.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        const token = authorization.slice(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "development-secret");
        req.user = decoded;
        return next();
    } catch (error) {
        return res.status(401).json({ message: "Invalid or expired token" });
    }
};