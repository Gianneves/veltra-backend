import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv';
import { authRoutes } from './routes/auth.route.ts';
dotenv.config()

const app = express()

app.use(cors())
app.use(express.json())

const port = process.env.PORT

app.use('/api/v1/auth/', authRoutes)

app.listen(port, () => {
    console.log(`server is running at port ${port}`)
})