const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000

app.use(express.json())
app.use(cors())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.3o3pwj7.mongodb.net/?appName=Cluster0`;

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
    const db = client.db('create_arena_db');
    const contestsCollection = db.collection('contests')

    // Get approved contests
    app.get('/contests/approved', async (req, res) => {
      const result = await contestsCollection
        .find({ status: "approved" })
        .toArray();
      res.send(result);
    });

    // Get single contest
    app.get('/contests/:id', async (req, res) => {
      const id = req.params.id;
      const result = await contestsCollection.findOne({
        _id: new ObjectId(id)
      });
      res.send(result);
    });

    // Get all contests
    app.get('/contests', async(req, res) => {
      const query = {}
      const cursor = contestsCollection.find(query)
      const result = await cursor.toArray()
      res.send(result)
    })

    // Create new contest
    app.post('/contests', async (req, res) => {
      const contest = req.body;
      contest.status = "pending";
      contest.createdAt = new Date();
      const result = await contestsCollection.insertOne(contest);
      res.send(result)
    })

    // Approve/Reject contest - SINGLE ENDPOINT
    app.patch('/contests/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const { status } = req.body;
      
      if (status === 'approved') {
        const updated = {
          $set: {
            status: "approved",
            approvedAt: new Date()
          }
        };
        const result = await contestsCollection.updateOne(filter, updated);
        res.send(result);
      } else if (status === 'rejected') {
        const updated = {
          $set: {
            status: "rejected",
            rejectedAt: new Date()
          }
        };
        const result = await contestsCollection.updateOne(filter, updated);
        res.send(result);
      } else {
        res.status(400).send({ error: 'Invalid status. Use "approved" or "rejected"' });
      }
    });

    // Stripe payment
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: amount,
            product_data: {
              name: paymentInfo.name
            }
          },
          quantity: 1,
        }],
        customer_email: paymentInfo.email,
        mode: 'payment',
        metadata: {
          contestId: paymentInfo.contestId
        },
        success_url: `${process.env.SITE_DOMAIN}/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`
      });
      
      res.send({url: session.url})
    });

    await client.db("admin").command({ ping: 1 });
    console.log("✅ MongoDB connected successfully!");
  } catch (error) {
    console.error('MongoDB connection error:', error);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send("🎯 Arena Server is Running")
})

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`)
})
