const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;
const crypto = require("crypto");

const admin = require("firebase-admin");
const serviceAccount = require("./create-arena-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

function generateTrackingId() {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${date}-${random}`;
}

app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  console.log('header in the middleware', req.headers.authorization)
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded", decoded)
    req.decoded_email = decoded.email;
    next()
  }
  catch (err) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.3o3pwj7.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("create_arena_db");
    const userCollection = db.collection("users");
    const contestsCollection = db.collection("contests");
    const paymentsCollection = db.collection("payments");
    const creatorCollection = db.collection('creators')

    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded_email;
        const user = await userCollection.findOne({ email });

        if (!user || user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden access' });
        }
        next();
      } catch (error) {
        res.status(500).send({ message: 'Admin verification failed' });
      }
    };

    // ✅ FIXED: Added missing creator approval/rejection routes
    // app.patch('/creator/approve/:id', verifyFBToken,  async (req, res) => {
    //   const id = req.params.id;

    //   try {
    //     const result = await creatorCollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       {
    //         $set: {
    //           status: 'approved',
    //           approvedAt: new Date()
    //         }
    //       }
    //     );

    //     if (result.matchedCount === 0) {
    //       return res.status(404).send({ message: 'Creator not found' });
    //     }

    //     res.send({ success: true, message: 'Creator approved successfully', result });
    //   } catch (error) {
    //     console.error('Approve creator error:', error);
    //     res.status(500).send({ message: 'Failed to approve creator' });
    //   }
    // });

    // app.patch('/creator/reject/:id', verifyFBToken, async (req, res) => {
    //   const id = req.params.id;

    //   try {
    //     const result = await creatorCollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       {
    //         $set: {
    //           status: 'rejected',
    //           rejectedAt: new Date()
    //         }
    //       }
    //     );

    //     if (result.matchedCount === 0) {
    //       return res.status(404).send({ message: 'Creator not found' });
    //     }

    //     res.send({ success: true, message: 'Creator rejected successfully', result });
    //   } catch (error) {
    //     console.error('Reject creator error:', error);
    //     res.status(500).send({ message: 'Failed to reject creator' });
    //   }
    // });

    // // Existing user approval routes (keeping them as they were)
    // app.patch('/creator/approve-user/:id', verifyFBToken, async (req, res) => {
    //   const id = req.params.id;

    //   const result = await userCollection.updateOne(
    //     { _id: new ObjectId(id) },
    //     {
    //       $set: {
    //         role: 'creator',
    //         approvedAt: new Date()
    //       }
    //     }
    //   );

    //   res.send(result);
    // });

    // app.patch('/creator/reject-user/:id', verifyFBToken,  async (req, res) => {
    //   const id = req.params.id;

    //   const result = await userCollection.updateOne(
    //     { _id: new ObjectId(id) },
    //     {
    //       $set: {
    //         role: 'user',
    //         rejectedAt: new Date()
    //       }
    //     }
    //   );

    //   res.send(result);
    // });

    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date();

      const email = user.email
      const userExist = await userCollection.findOne({ email })

      if (userExist) {
        return res.send({ message: 'user exists' })
      }

      const result = await userCollection.insertOne(user)
      res.send(result)
    })

    app.get("/contests/approved", async (req, res) => {
      const result = await contestsCollection
        .find({ status: "approved" })
        .toArray();
      res.send(result);
    });

    app.get("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const result = await contestsCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.get("/contests", async (req, res) => {
      const query = {};
      const cursor = contestsCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/contests", async (req, res) => {
      const contest = req.body;
      contest.status = "pending";
      contest.createdAt = new Date();
      const result = await contestsCollection.insertOne(contest);
      res.send(result);
    });

    app.patch("/contests/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const { status } = req.body;

      if (status === "approved") {
        const updated = {
          $set: {
            status: "approved",
            approvedAt: new Date(),
            trackingId: generateTrackingId(),
          },
        };
        const result = await contestsCollection.updateOne(filter, updated);
        res.send(result);
      } else if (status === "rejected") {
        const updated = {
          $set: {
            status: "rejected",
            rejectedAt: new Date(),
          },
        };
        const result = await contestsCollection.updateOne(filter, updated);
        res.send(result);
      } else {
        res
          .status(400)
          .send({ error: 'Invalid status. Use "approved" or "rejected"' });
      }
    });

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId) {
          return res.status(400).send({ error: "Session ID is required" });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const transactionId = session.payment_intent;

        const paymentExist = await paymentsCollection.findOne({ transactionId });

        if (paymentExist) {
          return res.send({
            message: "Payment already processed",
            transactionId: paymentExist.transactionId,
            trackingId: paymentExist.trackingId,
          });
        }

        const contestId = session.metadata.contestId;
        const email = session.customer_email;
        const amount = session.amount_total / 100;

        const trackingId = generateTrackingId();

        await paymentsCollection.insertOne({
          transactionId,
          trackingId,
          contestId,
          email,
          amount,
          sessionId,
          createdAt: new Date(),
        });

        await contestsCollection.updateOne(
          { _id: new ObjectId(contestId) },
          {
            $set: {
              paymentStatus: "paid",
              transactionId,
              trackingId,
            },
          }
        );

        res.send({
          transactionId,
          trackingId,
        });
      } catch (error) {
        console.error("Payment success error:", error);
        res.status(500).send({ error: "Payment processing failed" });
      }
    });

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.name,
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.email,
        mode: "payment",
        metadata: {
          contestId: paymentInfo.contestId,
          trackingId: paymentInfo.trackingId,
        },
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
      });

      res.send({ url: session.url });
    });

    app.get('/payments', verifyFBToken, async (req, res) => {
      try {
        const email = req.query.email;
        const query = {}

        if (email) {
          query.email = email
          if (email !== req.decoded_email) {
            return res.status(403).send({ message: 'forbidden Access' })
          }
        }

        if (!email) {
          return res.status(400).send({ error: 'Email is required' });
        }

        const payments = await paymentsCollection
          .find({ email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error('Get payments error:', error);
        res.status(500).send({ error: 'Failed to fetch payments' });
      }
    });

    app.get('/creator', async (req, res) => {
      try {
        const query = {};

        if (req.query.status === 'pending') {
          query.status = 'pending';
        }

        const result = await creatorCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch creators' });
      }
    });

    app.post('/creator', async (req, res) => {
      try {
        const creator = req.body;
        creator.status = 'pending'
        creator.createdAt = new Date()

        const result = await creatorCollection.insertOne(creator);
        res.send(result)
      } catch (error) {
        console.error('Create creator error:', error);
        res.status(500).send({ error: 'Failed to create creator request' });
      }
    });


    app.patch('/creator/:id', verifyFBToken, async(req, res) => {
      const status = req.body.status;
      const id = req.params.id
      const query = {_id: new ObjectId(id)}
      const updatedDoc = {
        $set: {
          status: status
        }
      }
      const result = await creatorCollection.updateOne(query, updatedDoc)

      if(status === "approved"){
        const email = req.body.email;
        const userQuery = {email}
        const updateUser = {
          $set: {
            role: "creator"
          }
        }
        const userResult= await userCollection.updateOne(userQuery, updateUser)
      }


      res.send(result)
    })

    await client.db("admin").command({ ping: 1 });
    console.log("✅ MongoDB connected successfully!");
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Arena Server is Running");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
