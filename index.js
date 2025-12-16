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

    const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
      if (!authHeader) {
      return res.status(401).send({ message: "Unauthorized" });
      }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "Invalid token" });
  }
};

const verifyAdmin = async (req, res, next) => {
  const user = await userCollection.findOne({
    email: req.decoded_email,
  });

  if (!user || user.role !== "admin") {
    return res.status(403).send({ message: "Admin access required" });
  }
  next();
};

const verifyCreatorOrAdmin = async (req, res, next) => {
  const user = await userCollection.findOne({
    email: req.decoded_email,
  });

  if (!user || !["creator", "admin"].includes(user.role)) {
    return res.status(403).send({ message: "Access denied" });
  }
  next();
};








    const verifyCreator = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || (user.role !== 'creator' && user.role !== 'admin')) {
        return res.status(403).send({ message: 'Creator access required' });
      }
      next();
    };


    const getOriginalAdmin = async () => {
      return await userCollection.findOne(
        { role: "admin" },
        { sort: { createdAt: 1 } }
      );
    };









app.get("/users/:email", verifyToken, async (req, res) => {
  try {
    const email = req.params.email;
    const user = await userCollection.findOne({ email });

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    res.send(user);
  } catch (error) {
    res.status(500).send({ message: "Profile fetch failed" });
  }
});


app.get("/users/:email/stats", verifyToken, async (req, res) => {
  try {
    const email = req.params.email;

    const participated = await paymentsCollection.countDocuments({ email });
    const won = await paymentsCollection.countDocuments({
      email,
      status: "winner", 
    });
    const createdContests = await contestsCollection.countDocuments({
      creatorEmail: email,
    });

    res.send({
      participated,
      won,
      createdContests,
    });
  } catch (error) {
    res.status(500).send({ message: "Stats fetch failed" });
  }
});


app.patch("/users/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const updateDoc = {
      $set: {
        name: req.body.name,
        bio: req.body.bio,
        photoURL: req.body.photoURL,
      },
    };

    const result = await userCollection.updateOne(
      { _id: new ObjectId(id) },
      updateDoc
    );

    if (!result.matchedCount) {
      return res.status(404).send({ message: "User not found" });
    }

    res.send({ message: "Profile updated" });
  } catch (error) {
    res.status(500).send({ message: "Update failed" });
  }
});



























// ================= USERS =================
app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  const users = await userCollection.find().toArray();
  res.send(users);
});

app.patch("/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const { role } = req.body;
  const requesterEmail = req.decoded_email;

  const originalAdmin = await userCollection.findOne(
    { role: "admin" },
    { sort: { createdAt: 1 } }
  );

  if (role === "admin" || role === "user") {
    if (!originalAdmin || originalAdmin.email !== requesterEmail) {
      return res.status(403).send({
        message: "Only original admin can change admin role",
      });
    }
  }

  const result = await userCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { role } }
  );

  res.send(result);
});

// ================= CREATORS =================
app.get("/creator", verifyToken, verifyAdmin, async (req, res) => {
  const creators = await creatorCollection.find().toArray();
  res.send(creators);
});

app.patch("/creator/:id", verifyToken, verifyAdmin, async (req, res) => {
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
 // ✅ FIXED: Users routes
    app.get("/users", verifyToken, verifyAdmin, async (req, routes) => {
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

    app.patch("/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
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
      const updatedDoc = { $set: { role } };
      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

  
    app.get("/contests", async (req, res) => {
      const contests = await contestsCollection.find().toArray();
      res.send(contests);
    });

    app.get("/contests/approved", async (req, res) => {
      const contests = await contestsCollection.find({ status: "approved" }).toArray();
      res.send(contests);
    });

    app.get("/contests/:id", async (req, res) => {
      const contest = await contestsCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(contest);
    });

    // app.post("/contests", verifyToken, verifyCreator, async (req, res) => {
    //   const contest = req.body;
    //   contest.status = "pending";
    //   contest.createdAt = new Date();
    //   contest.creatorEmail = req.decoded_email; // ✅ Added creator email
    //   const result = await contestsCollection.insertOne(contest);
    //   res.send(result);
    // });

app.post("/contests", verifyToken, verifyCreatorOrAdmin, async (req, res) => {
  const contest = req.body;
  contest.status = "pending";
  contest.createdAt = new Date();
  contest.creatorEmail = req.decoded_email;

  const result = await contestsCollection.insertOne(contest);
  res.send(result);
});

    app.get('/my-contests', verifyToken, verifyCreator, async (req, res) => {
      try {
        const email = req.query.email || req.decoded_email;
        const result = await contestsCollection.find({ 
          creatorEmail: email 
        }).sort({ createdAt: -1 }).toArray();
        
        
        const contestsWithCount = await Promise.all(result.map(async (contest) => {
          const count = await paymentsCollection.countDocuments({ 
            contestId: contest._id 
          });
          return { ...contest, participantsCount: count };
        }));
        
        res.send(contestsWithCount);
      } catch (error) {
        res.status(500).send({ message: 'Failed to fetch contests', error: error.message });
      }
    });

    // ✅ FIXED: Delete contest (Only pending + creator only)
    // app.delete('/contests/:id', verifyToken, verifyCreator, async (req, res) => {
    //   try {
    //     const contest = await contestsCollection.findOne({
    //       _id: new ObjectId(req.params.id),
    //       creatorEmail: req.decoded_email,
    //       status: 'pending' // ✅ Only pending contests
    //     });
        
    //     if (!contest) {
    //       return res.status(403).send({ message: 'Can only delete own pending contests' });
    //     }
        
    //     const result = await contestsCollection.deleteOne({ 
    //       _id: new ObjectId(req.params.id) 
    //     });
        
    //     if (result.deletedCount > 0) {
    //       res.send({ message: 'Contest deleted successfully' });
    //     } else {
    //       res.status(404).send({ message: 'Contest not found' });
    //     }
    //   } catch (error) {
    //     res.status(500).send({ message: 'Delete failed', error: error.message });
    //   }
    // });

    // app.patch("/contests/:id", verifyAdmin, async (req, res) => {
    //   const id = req.params.id;
    //   const updateData = { status: req.body.status };
      
    //   if (updateData.status === "approved") {
    //     updateData.approvedAt = new Date();
    //     updateData.trackingId = generateTrackingId();
    //   } else if (updateData.status === "rejected") {
    //     updateData.rejectedAt = new Date();
    //   } else {
    //     return res.status(400).send({ error: "Invalid status" });
    //   }

    //   const result = await contestsCollection.updateOne(
    //     { _id: new ObjectId(id) },
    //     { $set: updateData }
    //   );
    //   res.send(result);
    // });



app.patch(
  "/contests/:id",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    const { status } = req.body;
    const updateData = { status };

    if (status === "approved") {
      updateData.approvedAt = new Date();
      updateData.trackingId = generateTrackingId();
    } else if (status === "rejected") {
      updateData.rejectedAt = new Date();
    } else {
      return res.status(400).send({ message: "Invalid status" });
    }

    const result = await contestsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateData }
    );

    res.send(result);
  }
);


app.delete(
  "/contests/:id",
  verifyToken,
  verifyCreatorOrAdmin,
  async (req, res) => {
    const contest = await contestsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!contest) {
      return res.status(404).send({ message: "Contest not found" });
    }

    
    if (
      contest.creatorEmail === req.decoded_email &&
      contest.status === "pending"
    ) {
      await contestsCollection.deleteOne({ _id: contest._id });
      return res.send({ message: "Contest deleted" });
    }

  
    const user = await userCollection.findOne({
      email: req.decoded_email,
    });

    if (user.role === "admin") {
      await contestsCollection.deleteOne({ _id: contest._id });
      return res.send({ message: "Contest deleted by admin" });
    }

    return res.status(403).send({ message: "Delete not allowed" });
  }
);
    app.get('/contests/:contestId/participants', verifyToken, async (req, res) => {
      try {
        const participants = await paymentsCollection
          .find({ contestId: req.params.contestId })
          .project({ email: 1, name: 1, photoURL: 1, createdAt: 1 })
          .toArray();
        res.send(participants);
      } catch (error) {
        res.status(500).send({ message: 'Participants fetch failed' });
      }
    });

    app.post("/create-checkout-session", verifyToken, async (req, res) => {
      const { price, name, email, contestId } = req.body;
      const amount = parseInt(price) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [{
          price_data: {
            currency: "usd",
            unit_amount: amount,
            product_data: { name },
          },
          quantity: 1,
        }],
        customer_email: email,
        mode: "payment",
        metadata: { contestId },
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
      });

      res.send({ url: session.url });
    });

    app.patch("/payment-success", verifyToken, async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const transactionId = session.payment_intent;
        const contestId = session.metadata.contestId;
        const email = session.customer_email;
        const amount = session.amount_total / 100;
        const trackingId = generateTrackingId();

        const paymentExist = await paymentsCollection.findOne({ transactionId });
        if (paymentExist) return res.send(paymentExist);

        const paymentData = {
          transactionId,
          trackingId,
          contestId,
          email,
          amount,
          name: session.customer_details?.name || 'Unknown',
          photoURL: session.customer_details?.photoURL || '/default-avatar.png',
          createdAt: new Date(),
        };

        await paymentsCollection.insertOne(paymentData);

        res.send({ transactionId, trackingId });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Payment processing failed" });
      }
    });

    
    app.get("/creator", verifyToken, verifyAdmin, async (req, res) => {
      const sort = req.query.sort || "new";
      const sortOption = sort === "new" ? { createdAt: -1 } : { createdAt: 1 };
      const creators = await creatorCollection.find().sort(sortOption).toArray();
      res.send(creators);
    });

    app.post("/creator", verifyToken, async (req, res) => {
      const creator = req.body;
      creator.status = "pending";
      creator.createdAt = new Date();
      const result = await creatorCollection.insertOne(creator);
      res.send(result);
    });

    app.patch("/creator/:id", verifyToken, verifyAdmin, async (req, res) => {
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
  res.send("Arena Server is Running ✅");
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));















