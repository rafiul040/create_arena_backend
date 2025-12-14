const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const crypto = require("crypto");
const admin = require("firebase-admin");
const serviceAccount = require("./create-arena-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const prefix = "PRCL";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${date}-${random}`;
}

app.use(cors());
app.use(express.json());

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
    const creatorCollection = db.collection("creators");

    const verifyFBToken = async (req, res, next) => {
      const token = req.headers.authorization;
      if (!token)
        return res.status(401).send({ message: "Unauthorized access" });
      try {
        const idToken = token.split(" ")[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        req.decoded_email = decoded.email;
        next();
      } catch {
        return res.status(401).send({ message: "Unauthorized access" });
      }
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email
      const query = {email}
      const user = await userCollection.findOne(query)

      if(!user || user.role !== 'admin'){
        return res.status(403).send({message: 'forbidden access'})
      }
        
        next();
      
    };


const getOriginalAdmin = async () => {
  return await userCollection.findOne(
    { role: "admin" },
    { sort: { createdAt: 1 } } // 👑 first admin
  );
};



    app.get("/users", verifyFBToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      res.send({ role: user?.role || "user" });
    });

    
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const userExist = await userCollection.findOne({ email: user.email });
      if (userExist) return res.send({ message: "User already exists" });
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    


    app.patch(
  "/users/:id/role",
  verifyFBToken,
  verifyAdmin,
  async (req, res) => {
    const id = req.params.id;
    const { role } = req.body;

    const requesterEmail = req.decoded_email;

    
    const originalAdmin = await getOriginalAdmin();

    
    if (role === "admin" || role === "user") {
      if (!originalAdmin || originalAdmin.email !== requesterEmail) {
        return res.status(403).send({
          message: "Only original admin can change admin role",
        });
      }
    }

    const query = { _id: new ObjectId(id) };
    const updatedDoc = {
      $set: { role },
    };

    const result = await userCollection.updateOne(query, updatedDoc);
    res.send(result);
  }
);

 
    app.patch("/users/:id", verifyFBToken, async (req, res) => {
      res.status(410).send({ message: "Use /users/:id/role endpoint instead" });
    });

  
    app.get("/contests", async (req, res) => {
      const contests = await contestsCollection.find().toArray();
      res.send(contests);
    });

    app.get("/contests/approved", async (req, res) => {
      const contests = await contestsCollection
        .find({ status: "approved" })
        .toArray();
      res.send(contests);
    });

    app.get("/contests/:id", async (req, res) => {
      const contest = await contestsCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(contest);
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
      const { status } = req.body;
      const updateData = { status };
      if (status === "approved") {
        updateData.approvedAt = new Date();
        updateData.trackingId = generateTrackingId();
      } else if (status === "rejected") {
        updateData.rejectedAt = new Date();
      } else return res.status(400).send({ error: "Invalid status" });

      const result = await contestsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );
      res.send(result);
    });


    app.post("/create-checkout-session", async (req, res) => {
      const { price, name, email, contestId } = req.body;
      const amount = parseInt(price) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: { name },
            },
            quantity: 1,
          },
        ],
        customer_email: email,
        mode: "payment",
        metadata: { contestId },
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
      });

      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const transactionId = session.payment_intent;
        const contestId = session.metadata.contestId;
        const email = session.customer_email;
        const amount = session.amount_total / 100;
        const trackingId = generateTrackingId();

        const paymentExist = await paymentsCollection.findOne({
          transactionId,
        });
        if (paymentExist) return res.send(paymentExist);

        await paymentsCollection.insertOne({
          transactionId,
          trackingId,
          contestId,
          email,
          amount,
          createdAt: new Date(),
        });
        await contestsCollection.updateOne(
          { _id: new ObjectId(contestId) },
          { $set: { paymentStatus: "paid", transactionId, trackingId } }
        );

        res.send({ transactionId, trackingId });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Payment processing failed" });
      }
    });

    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      if (!email || email !== req.decoded_email)
        return res.status(403).send({ message: "Forbidden access" });
      const payments = await paymentsCollection
        .find({ email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(payments);
    });

    
    app.get("/creator", async (req, res) => {
      const sort = req.query.sort || "new";
      const sortOption = sort === "new" ? { createdAt: -1 } : { createdAt: 1 };
      const creators = await creatorCollection
        .find()
        .sort(sortOption)
        .toArray();
      res.send(creators);
    });

    app.post("/creator", async (req, res) => {
      const creator = req.body;
      creator.status = "pending";
      creator.createdAt = new Date();
      const result = await creatorCollection.insertOne(creator);
      res.send(result);
    });

    app.patch("/creator/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const { status, email } = req.body;

      const result = await creatorCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );

      if (status === "approved" && email) {
        await userCollection.updateOne(
          { email },
          { $set: { role: "creator" } }
        );
      }

      res.send(result);
    });

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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));



