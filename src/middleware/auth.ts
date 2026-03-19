import type { Request, Response, NextFunction } from "express";
import dotenv from 'dotenv';
dotenv.config();
import jwt  from "jsonwebtoken";


export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const token = req.headers['authorization']

    if (!token) {
        res.status(400).json({ message: "Token inválido ou não fornecido" })
        return
    }

    const secretKey = process.env.SECRET_KEY_JWT
    if(!secretKey) return res.status(400).json({ message: "Token falhou" })

    jwt.verify(token, secretKey, (err, decoded) => {
        if (err) {
            res.status(400).json({ message: "Token inválido ou não fornecido" })
            return
        }

        console.error(decoded)

       
        next()
    })
}