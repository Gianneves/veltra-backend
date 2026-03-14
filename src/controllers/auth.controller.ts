import { Request, Response } from 'express'
import { authService } from '../services/auth.service.ts'

export const authController = {
    loginWithStrava: (req: Request, res: Response) => {
        try {
            const authUrl = authService.generateStravaAuthUrl()

            return res.redirect(authUrl)
        } catch (error) {
            return res.status(500).json({ message: "Erro ao redirecionar para o Strava" });
        }
    },

    stravaCallback: async (req: Request, res: Response) => {
        const { code } = req.query

        if (!code) {
            return res.status(400).json({ error: "Código de autorização não fornecido" });
        }

        try {
            const user = await authService.authenticateWithStrava(String(code))

            return res.status(200).json({
                message: "Autenticado com sucesso!",
                user
            });

        } catch (error) {
            return res.status(500).json({ error: "Falha na autenticação com o Strava" });
        }
    }

}