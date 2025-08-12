require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Basic env checks
if (!process.env.DB_USER || !process.env.DB_PASS || !process.env.JWT_SECRET) {
  console.error('❌ Missing required environment variables. Check DB_USER, DB_PASS, JWT_SECRET in .env');
  process.exit(1);
}

// MongoDB URI (encode credentials)
const DB_USER = encodeURIComponent(process.env.DB_USER);
const DB_PASS = encodeURIComponent(process.env.DB_PASS);
const DB_NAME = process.env.DB_NAME || 'Travling-Hotel';
const uri = `mongodb+srv://${DB_USER}:${DB_PASS}@cluster0.jfgqsm5.mongodb.net/${DB_NAME}?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Middleware
app.use(express.json());
app.use(cookieParser());

// CORS config from env
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim());

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // allow curl/postman/no origin
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS policy: Origin not allowed'), false);
  },
  credentials: true
}));

// Cookie options helper
function cookieOptions() {
  // In production, set secure: true and sameSite: 'None'
  const isProd = NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'None' : 'Lax',
    // maxAge: 1000 * 60 * 60 * 24 * 30, // optional: 30 days
  };
}

// JWT verify middleware
function verifyJWT(req, res, next) {
  const token = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);
  if (!token) return res.status(401).json({ message: 'Unauthorized: No token provided' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Forbidden: Invalid or expired token' });
    }
    req.user = decoded;
    next();
  });
}

// Main async function
async function run() {
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const favoriteCollection = db.collection('Favorite');
    const usersCollection = db.collection('users');

    app.get('/', (req, res) => res.send('Hello World — Travling warp!'));

    // Create or update user + set JWT cookie
    app.post('/users', async (req, res) => {
      try {
        const user = req.body;
        if (!user?.email) return res.status(400).json({ message: 'Email is required' });

        const email = user.email.toLowerCase();
        const filter = { email };

        // Remove createdAt from user if exists to avoid conflict
        const { createdAt, ...restUser } = user;

        const update = {
          $set: { ...restUser, email, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() }
        };
        const options = { upsert: true };

        const result = await usersCollection.updateOne(filter, update, options);

        const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '365d' });

        res.cookie('token', token, cookieOptions()).status(200).json({ success: true, upsertedId: result.upsertedId || null });
      } catch (err) {
        console.error('POST /users error:', err);
        res.status(500).json({ message: 'Server error creating/updating user' });
      }
    });

    // Create/refresh short token endpoint
    app.post('/jwt', async (req, res) => {
      try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Email required' });

        const user = await usersCollection.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '200h' });
        res.cookie('token', token, cookieOptions()).status(200).json({ success: true });
      } catch (err) {
        console.error('POST /jwt error:', err);
        res.status(500).json({ message: 'Could not create token' });
      }
    });

    // Logout route
    app.post('/logout', (req, res) => {
      res.clearCookie('token', cookieOptions());
      res.status(200).json({ success: true, message: 'Logged out successfully' });
    });

    // Wishlist routes (protected)
    app.post('/wishlist', verifyJWT, async (req, res) => {
      try {
        const item = req.body;
        if (!item || !item.id) return res.status(400).json({ message: 'Invalid wishlist data: missing id' });

        const userEmail = req.user?.email;
        if (!userEmail) return res.status(403).json({ message: 'Forbidden: user email missing in token' });

        item.email = userEmail;

        const exists = await favoriteCollection.findOne({ id: item.id, email: userEmail });
        if (exists) return res.status(409).json({ message: 'Item already added to wishlist' });

        const result = await favoriteCollection.insertOne({ ...item, createdAt: new Date() });
        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error('POST /wishlist error:', err);
        res.status(500).json({ message: 'Server error adding to wishlist' });
      }
    });

    app.post('/wishlist-recommend', verifyJWT, async (req, res) => {
      try {
        const item = req.body;
        if (!item || !item.hotelId || !item.name) return res.status(400).json({ message: 'Invalid data' });

        const userEmail = req.user?.email;
        if (!userEmail) return res.status(403).json({ message: 'Forbidden: user email missing in token' });

        item.email = userEmail;

        const exists = await favoriteCollection.findOne({ hotelId: item.hotelId, email: userEmail });
        if (exists) return res.status(200).json({ message: 'Already in wishlist' });

        const result = await favoriteCollection.insertOne({ ...item, createdAt: new Date() });
        res.status(201).json({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error('POST /wishlist-recommend error:', err);
        res.status(500).json({ message: 'Server error' });
      }
    });

    app.get('/wishlist', verifyJWT, async (req, res) => {
      try {
        const userEmail = req.user?.email;
        if (!userEmail) return res.status(403).json({ message: 'Forbidden: user email missing in token' });

        const items = await favoriteCollection.find({ email: userEmail }).toArray();
        res.status(200).json(items);
      } catch (err) {
        console.error('GET /wishlist error:', err);
        res.status(500).json({ message: 'Server error fetching wishlist' });
      }
    });

  app.delete('/wishlist/:id', verifyJWT, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }

    const userEmail = req.user?.email;
    if (!userEmail) {
      return res.status(403).json({ message: 'Forbidden: user email missing in token' });
    }

    const query = { _id: new ObjectId(id), email: userEmail };
    const result = await favoriteCollection.deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Not found or not authorized to delete' });
    }

    // deletedCount সহ response পাঠানো
    res.status(200).json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('DELETE /wishlist/:id error:', err);
    res.status(500).json({ message: 'Server error deleting wishlist item' });
  }
});


    // Ping DB to confirm connection
    await client.db('admin').command({ ping: 1 });
    console.log('✅ Connected to MongoDB & routes are set.');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Run error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('SIGINT received. Closing MongoDB client...');
  try {
    await client.close();
    console.log('MongoDB client closed.');
    process.exit(0);
  } catch (err) {
    console.error('Error closing MongoDB client:', err);
    process.exit(1);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT} (${NODE_ENV})`);
});
