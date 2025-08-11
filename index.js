const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const app = express();
const cors = require('cors');
const dotenv = require('dotenv').config();
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const port = 5000;

// middleware 
app.use(cors({
    origin: [
        'https://travling-clint-site.vercel.app',
        // https://travling-server-site.vercel.app
        'http://localhost:5173'
    ],
    credentials: true // এটা দিতে হবে কুকি পাঠানোর জন্য
}));
app.use(express.json());
app.use(cookieParser());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_USER_PASSWORD}@cluster0.jfgqsm5.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// MongoClient setup
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// JWT verification middleware
function verifyJWT(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).send({ message: "Unauthorized: No token provided" });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).send({ message: "Forbidden: Invalid token" });
        }
        req.user = decoded; // ডিকোড করা ইউজার ডেটা মডিউলে রেখে দাও
        next();
    });
}

async function run() {
    try {
        await client.connect();
        const userCollection = client.db('Travling-Hotel').collection('Favorite');
        const usersCollection2 = client.db('Travling-Hotel').collection('users');

        // POST route: Save new user & create JWT
        app.post('/users', async (req, res) => {
            const user = req.body;

            // Check if user already exists
            const existingUser = await usersCollection2.findOne({ email: user.email });
            if (existingUser) {
                return res.status(200).send({ message: "User already exists" });
            }

            // Save new user to DB
            const result = await usersCollection2.insertOne(user);

            // Create JWT token
            const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '365d' });

            // Send token as cookie
            res.cookie('token', token, {
                httpOnly: true,
                secure: false, // production এ true দিতে হবে (HTTPS হলে)
                sameSite: 'Lax'
            }).send({ success: true, insertedId: result.insertedId });
        });

        // POST route: Add to Favorite (protected route)
        app.post('/wishlist', verifyJWT, async (req, res) => {
            const favoriteItem = req.body;

            if (!favoriteItem || !favoriteItem.id || !favoriteItem.email) {
                return res.status(400).send({ message: "Invalid wishlist data" });
            }

            try {
                // Check if the item is already in the wishlist for this user
                const exists = await userCollection.findOne({
                    id: favoriteItem.id,
                    email: favoriteItem.email
                });

                if (exists) {
                    return res.status(400).send({ message: "Item already added to wishlist" });
                }

                // If not exists, insert the new item
                const result = await userCollection.insertOne(favoriteItem);
                res.status(200).send(result);
            } catch (error) {
                console.error('Wishlist insert error:', error);
                res.status(500).send({ message: "Server error" });
            }
        });

        // POST route: Add to wishlist-recommend (protected route)
        app.post('/wishlist-recommend', verifyJWT, async (req, res) => {
            const item = req.body;

            // Basic validation
            if (!item || !item.hotelId || !item.name || !item.email) {
                return res.status(400).send({ message: "Invalid wishlist data" });
            }

            // Optional: Check if already exists
            const exists = await userCollection.findOne({ hotelId: item.hotelId, email: item.email });
            if (exists) {
                return res.status(200).send({ message: "Already in wishlist" });
            }

            const result = await userCollection.insertOne(item);
            res.status(200).send(result);
        });

        // GET route: Fetch all favorites (protected route)
        app.get('/wishlist', verifyJWT, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        // DELETE wishlist item (protected route)
        app.delete('/wishlist/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await userCollection.deleteOne(query);
            res.send(result);
        });

        // Jwt token route (Create/refresh token)
        app.post('/jwt', (req, res) => {
            const user = req.body; // ফ্রন্টএন্ড থেকে আসা ইউজার অবজেক্ট

            const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '1h' });

            res.cookie('token', token, {
                httpOnly: true,
                secure: false, // HTTPS হলে true
                sameSite: 'Lax'
            }).send({ success: true });
        });

        // logout
        app.post('/logout', (req, res) => {
            res.clearCookie('token', {
                httpOnly: true,
                secure: false, // production এ true
                sameSite: 'Lax'
            });
            res.send({ success: true, message: 'Logged out successfully' });
        });


        // Test MongoDB connection
        await client.db("admin").command({ ping: 1 });
        console.log("✅ Connected to MongoDB!");

    } catch (err) {
        console.error("MongoDB connection error:", err);
    }
}
run().catch(console.dir);

// Base route
app.get('/', (req, res) => {
    res.send('Hello World, I am from Travling warp!');
});

// Start server
app.listen(port, () => {
    console.log(`✅ Server running on port ${port}`);
});
