// A local PeerJS lobby server for the multiplayer tests (the app build points at 127.0.0.1:<port>/gd).
import http from 'node:http'
import express from 'express'
import { ExpressPeerServer } from 'peer'

const port = Number(process.argv[2] ?? 9100)
const app = express()
const server = http.createServer(app)
app.use('/gd', ExpressPeerServer(server, { path: '/' }))
server.listen(port, '127.0.0.1', () => console.log(`peer server on 127.0.0.1:${port}/gd`))
