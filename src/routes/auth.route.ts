import { Router } from 'express';
import { authController } from '../controllers/auth.controller.ts';

export const authRoutes = Router()

authRoutes.get('/strava', authController.loginWithStrava)
authRoutes.get('/strava/callback', authController.stravaCallback)