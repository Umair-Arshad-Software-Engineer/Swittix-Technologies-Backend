// // src/config/server-pool.js
// const express = require('express');
// const db = require('./db');

// const app = express();
// const PORT = process.env.PORT || 3000;

// app.use(express.json());

// // Example route using pool
// app.get('/api/users', async (req, res) => {
//     try {
//         const [rows] = await db.query('SELECT * FROM users');
//         res.json(rows);
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ error: 'Database query failed' });
//     }
// });

// app.post('/api/users', async (req, res) => {
//     const { name, email } = req.body;
    
//     try {
//         const [result] = await db.query(
//             'INSERT INTO users (name, email) VALUES (?, ?)',
//             [name, email]
//         );
//         res.json({ id: result.insertId, name, email });
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ error: 'Failed to create user' });
//     }
// });

// app.listen(PORT, () => {
//     console.log(`Server running on http://localhost:${PORT}`);
// });