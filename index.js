const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const app = express();
const cors = require('cors');
const dotenv = require('dotenv').config();
const port = 5000;

// middleware 
app.use(cors({
    origin:
        [
            'https://travling-clint-site.vercel.app',
            'http://localhost:5173'
        ]

    //   credentials: true // optional: for cookies, authorization headers, etc.
}));
app.use(express.json());

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

async function run() {
    try {
        await client.connect();
        const userCollection = client.db('Travling-Hotel').collection('Favorite');

        // ✅ POST route: Add to Favorite
        app.post('/wishlist', async (req, res) => {
            const favoriteItem = req.body;

            if (!favoriteItem || !favoriteItem.id) {
                return res.status(400).send({ message: "Invalid wishlist data" });
            }

            const result = await userCollection.insertOne(favoriteItem);
            res.status(200).send(result);
        });

        // (Optional) GET route: Fetch all favorites
        app.get('/wishlist', async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        // delete wishlist
        app.delete('/wishlist/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await userCollection.deleteOne(query);
            res.send(result);
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
    res.send('Hello World!');
});

// Start server
app.listen(port, () => {
    console.log(`✅ Server running on port ${port}`);
});
