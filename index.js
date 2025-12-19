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
      if (!authHeader) return res.status(401).send({ message: "Unauthorized" });

      try {
        const token = authHeader.split(" ")[1];
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded_email = decoded.email;
        next();
      } catch {
        res.status(401).send({ message: "Invalid token" });
      }
    };

    const verifyAdmin = async (req, res, next) => {
      const user = await userCollection.findOne({ email: req.decoded_email });
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Admin access required" });
      }
      next();
    };

    const verifyCreatorOrAdmin = async (req, res, next) => {
      const user = await userCollection.findOne({ email: req.decoded_email });
      if (!user || !["creator", "admin"].includes(user.role)) {
        return res.status(403).send({ message: "Access denied" });
      }
      next();
    };

    app.post("/users", async (req, res) => {
      const exist = await userCollection.findOne({ email: req.body.email });
      if (exist) return res.send({ message: "User already exists" });

      await userCollection.insertOne({
        ...req.body,
        role: "user",
        createdAt: new Date(),
      });

      res.send({ message: "User created" });
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne({
        ...payment,
        createdAt: new Date(),
      });
      res.send(result);
    });

    app.get("/contests/:id/participants", async (req, res) => {
      const contestId = req.params.id;
      const result = await paymentsCollection
        .find({
          contestId,
          paymentStatus: "paid",
        })
        .toArray();
      res.send(result);
    });
    app.get("/users/:email/participated", async (req, res) => {
      const email = req.params.email;

      const contests = await paymentsCollection
        .find({
          email,
          paymentStatus: "paid",
        })
        .toArray();

      res.send(contests);
    });
    app.get("/users/:email/payments", async (req, res) => {
      const email = req.params.email;
      const result = await paymentsCollection.find({ email }).toArray();
      res.send(result);
    });
    app.get("/users/:email/stats", async (req, res) => {
      const email = req.params.email;

      const participated = await paymentsCollection.countDocuments({ email });
      const won = await contestsCollection.countDocuments({
        winnerEmail: email,
      });
      const created = await contestsCollection.countDocuments({
        creatorEmail: email,
      });

      res.send({ participated, won, createdContests: created });
    });

    app.patch(
      "/declare-winner",
      verifyToken,
      verifyCreatorOrAdmin,
      async (req, res) => {
        const { contestId, submissionId, winnerEmail } = req.body;

        await paymentsCollection.updateOne(
          { _id: new ObjectId(submissionId) },
          { $set: { isWinner: true } }
        );

        await paymentsCollection.updateMany(
          { contestId },
          { $set: { contestWinnerDeclared: true } }
        );

        res.send({ message: "Winner declared successfully" });
      }
    );

    // app.patch("/payment-success", verifyToken, async (req, res) => {
    //   const sessionId = req.query.session_id;
    //   if (!sessionId)
    //     return res.status(400).send({ message: "session_id required" });

    //   try {
    //     const session = await stripe.checkout.sessions.retrieve(sessionId);

    //     if (session.payment_status !== "paid") {
    //       return res.status(400).send({ message: "Payment not completed" });
    //     }

    //     const email = session.customer_email;
    //     const contestName =
    //       session.display_items?.[0]?.custom?.name ||
    //       session.metadata?.name ||
    //       session.line_items?.data[0]?.description ||
    //       "Unknown Contest";

    //     const contest = await contestsCollection.findOne({ name: contestName });

    //     if (!contest)
    //       return res.status(404).send({ message: "Contest not found" });

    //     const existingPayment = await paymentsCollection.findOne({
    //       email,
    //       contestId: contest._id.toString(),
    //       paymentStatus: "paid",
    //     });

    //     if (existingPayment) {
    //       return res.send({
    //         message: "Already registered",
    //         transactionId: existingPayment.transactionId,
    //         trackingId: existingPayment.trackingId,
    //       });
    //     }

    //     const transactionId = session.payment_intent;
    //     const trackingId = generateTrackingId();

    //     await paymentsCollection.insertOne({
    //       email,
    //       contestId: contest._id.toString(),
    //       contestName: contest.name,
    //       price: contest.price,
    //       paymentStatus: "paid",
    //       transactionId,
    //       trackingId,
    //       createdAt: new Date(),
    //     });

    //     res.send({ transactionId, trackingId });
    //   } catch (error) {
    //     console.error("Payment success error:", error);
    //     res.status(500).send({ message: "Payment confirmation failed" });
    //   }
    // });
    app.post(
      "/contests/:contestId/submit-task",
      verifyToken,
      async (req, res) => {
        const { contestId } = req.params;
        const email = req.decoded_email;
        const { submissionLink } = req.body;

        if (!submissionLink) {
          return res
            .status(400)
            .send({ message: "Submission link is required" });
        }

        const paymentRecord = await paymentsCollection.findOne({
          email,
          contestId,
          paymentStatus: "paid",
        });

        if (!paymentRecord) {
          return res
            .status(403)
            .send({ message: "User not registered for this contest" });
        }

        await paymentsCollection.updateOne(
          { _id: paymentRecord._id },
          {
            $push: {
              submissions: {
                link: submissionLink,
                submittedAt: new Date(),
              },
            },
          }
        );

        res.send({ message: "Task submitted successfully" });
      }
    )











app.get("/payment-success", verifyToken, async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) {
    return res.status(400).send({ message: "session_id required" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items"],
    });

    if (session.payment_status !== "paid") {
      return res.status(400).send({ message: "Payment not completed" });
    }

    const email = req.decoded_email;
    const contestId = session.metadata?.contestId;
    const contestName = session.metadata?.name;

    if (!contestId || !contestName) {
      return res.status(400).send({ message: "Contest information missing" });
    }

    // Check if already paid for this contest
    const existingPayment = await paymentsCollection.findOne({
      email,
      contestId,
      paymentStatus: "paid",
    });

    if (existingPayment) {
      return res.send({
        message: "Already registered for this contest",
        transactionId: existingPayment.transactionId,
        trackingId: existingPayment.trackingId,
      });
    }

    const contest = await contestsCollection.findOne({
      _id: new ObjectId(contestId),
    });
    if (!contest) {
      return res.status(404).send({ message: "Contest not found" });
    }

    const transactionId = session.payment_intent;
    const trackingId = generateTrackingId();
    const price = parseInt(session.amount_total) / 100;

    const paymentDoc = {
      email,
      contestId,
      contestName,
      price,
      paymentStatus: "paid",
      transactionId,
      trackingId,
      createdAt: new Date(),
    };

    await paymentsCollection.insertOne(paymentDoc);

    // ✅ OPTIONAL: Also increment contest participantsCount
    await contestsCollection.findOneAndUpdate(
      { _id: new ObjectId(contestId) },
      { $inc: { participantsCount: 1 } }
    );

    res.send({
      message: "Payment confirmed! You're now registered.",
      transactionId,
      trackingId,
      contestId,
    });
  } catch (error) {
    console.error("Payment success error:", error);
    res.status(500).send({ message: "Payment confirmation failed" });
  }
});















app.get(
  "/my-contests",
  verifyToken,
  verifyCreatorOrAdmin,
  async (req, res) => {
    const email = req.query.email;

    if (email !== req.decoded_email) {
      return res.status(403).send({ message: "Forbidden" });
    }

    const contests = await contestsCollection
      .find({ creatorEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(contests);
  }
);

app.get(
  "/contests/:id/submissions",
  verifyToken,
  verifyCreatorOrAdmin,
  async (req, res) => {
    const contestId = req.params.id;

    const submissions = await paymentsCollection
      .find({
        contestId,
        paymentStatus: "paid",
        submissions: { $exists: true },
      })
      .project({
        email: 1,
        submissions: 1,
        isWinner: 1,
      })
      .toArray();

    res.send(submissions);
  }
);


app.patch(
  "/contests/:id/edit",
  verifyToken,
  verifyCreatorOrAdmin,
  async (req, res) => {
    const { id } = req.params;
    const email = req.decoded_email;

    const contest = await contestsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!contest) {
      return res.status(404).send({ message: "Contest not found" });
    }

    
    if (
      contest.creatorEmail !== email ||
      contest.status !== "pending"
    ) {
      return res.status(403).send({ message: "Unauthorized edit" });
    }

    const updateData = {
      name: req.body.name,
      price: req.body.price,
      prizeMoney: req.body.prizeMoney,
      updatedAt: new Date(),
    };

    await contestsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    res.send({ message: "Contest updated successfully" });
  }
);





    app.get("/my-participated-contests/:email", async (req, res) => {
      const email = req.params.email;

      try {
        const payments = await paymentsCollection
          .find({ email, paymentStatus: "paid" })
          .sort({ createdAt: -1 })
          .toArray();

        const contestsWithDetails = await Promise.all(
          payments.map(async (payment) => {
            const contest = await contestsCollection.findOne({
              _id: new ObjectId(payment.contestId),
            });
            return {
              ...payment,
              contestDetails: contest || { name: "Contest Deleted" },
            };
          })
        );

        res.send(contestsWithDetails);
      } catch (error) {
        console.error("Participated contests error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/payments/history/:email", async (req, res) => {
      const email = req.params.email;
      const history = await paymentsCollection
        .find({ email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(history);
    });

    app.get("/my-winning-contests/:email", async (req, res) => {
      const email = req.params.email;

      const wins = await paymentsCollection
        .find({
          email,
          $or: [{ isWinner: true }, { winner: true }],
        })
        .sort({ createdAt: -1 })
        .toArray();

      const winsWithDetails = await Promise.all(
        wins.map(async (win) => {
          const contest = await contestsCollection.findOne({
            _id: new ObjectId(win.contestId),
          });
          return {
            ...win,
            contestName: contest?.name || win.contestName,
            contestImage: contest?.image,
          };
        })
      );

      res.send(winsWithDetails);
    });

    app.get("/users/:email/stats", async (req, res) => {
      const email = req.params.email;

      const participated = await paymentsCollection.countDocuments({
        email,
        paymentStatus: "paid",
      });

      const won = await paymentsCollection.countDocuments({
        email,
        winner: true,
      });

      const createdContests = await contestsCollection.countDocuments({
        creatorEmail: email,
      });

      res.send({ participated, won, createdContests });
    });

    app.get("/my-winning-contests/:email", async (req, res) => {
      const email = req.params.email;

      const wins = await paymentsCollection
        .find({ email, winner: true })
        .toArray();

      res.send(wins);
    });
    app.patch("/contests/:id/winner", async (req, res) => {
      const { contestId, email } = req.body;

      await paymentsCollection.updateOne(
        { contestId, email },
        { $set: { winner: true } }
      );

      res.send({ success: true });
    });

    app.get("/users/:email", verifyToken, async (req, res) => {
      if (req.params.email !== req.decoded_email) {
        return res.status(403).send({ message: "Forbidden" });
      }

      const user = await userCollection.findOne({ email: req.params.email });
      res.send(user);
    });

    app.patch("/users/email/:email", verifyToken, async (req, res) => {
      if (req.params.email !== req.decoded_email) {
        return res.status(403).send({ message: "Forbidden" });
      }

      await userCollection.updateOne(
        { email: req.params.email },
        {
          $set: {
            displayName: req.body.displayName,
            photoURL: req.body.photoURL,
            phone: req.body.phone,
            bio: req.body.bio,
          },
        }
      );

      res.send({ message: "Profile updated successfully" });
    });

    app.get("/users/:email/stats", verifyToken, async (req, res) => {
      const email = req.params.email;

      const participated = await paymentsCollection.countDocuments({ email });
      const createdContests = await contestsCollection.countDocuments({
        creatorEmail: email,
      });

      res.send({ participated, createdContests });
    });

    app.get("/users/:email/role", async (req, res) => {
      const user = await userCollection.findOne({ email: req.params.email });
      res.send({ role: user?.role || "user" });
    });

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.patch("/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
      await userCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { role: req.body.role } }
      );
      res.send({ message: "Role updated" });
    });

    app.post("/creator", verifyToken, async (req, res) => {
      await creatorCollection.insertOne({
        ...req.body,
        status: "pending",
        createdAt: new Date(),
      });
      res.send({ message: "Creator request sent" });
    });

    app.get("/creator", verifyToken, verifyAdmin, async (req, res) => {
      const creators = await creatorCollection.find().toArray();
      res.send(creators);
    });

    app.patch("/creator/:id", verifyToken, verifyAdmin, async (req, res) => {
      await creatorCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: req.body.status } }
      );

      if (req.body.status === "approved") {
        await userCollection.updateOne(
          { email: req.body.email },
          { $set: { role: "creator" } }
        );
      }

      res.send({ message: "Creator updated" });
    });

    app.get("/contests", async (req, res) => {
      res.send(await contestsCollection.find().toArray());
    });

    app.get("/contests/approved", async (req, res) => {
      res.send(await contestsCollection.find({ status: "approved" }).toArray());
    });

    app.post(
      "/contests",
      verifyToken,
      verifyCreatorOrAdmin,
      async (req, res) => {
        await contestsCollection.insertOne({
          ...req.body,
          status: "pending",
          creatorEmail: req.decoded_email,
          createdAt: new Date(),
        });
        res.send({ message: "Contest created" });
      }
    );

    app.patch("/contests/:id", verifyToken, verifyAdmin, async (req, res) => {
      const update = { status: req.body.status };
      if (req.body.status === "approved") {
        update.trackingId = generateTrackingId();
        update.approvedAt = new Date();
      }
      await contestsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: update }
      );
      res.send({ message: "Contest updated" });
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
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid contest id" });
        }

        const contest = await contestsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!contest) {
          return res.status(404).send({ message: "Contest not found" });
        }

        res.send(contest);
      } catch (error) {
        console.error("Get contest details error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/contests/:id/participants", async (req, res) => {
      try {
        const contestId = req.params.id;

        if (!ObjectId.isValid(contestId)) {
          return res.status(400).send({ message: "Invalid contest id" });
        }

        const paymentDocs = await paymentsCollection
          .find({ contestId, paymentStatus: "paid" })
          .toArray();

        const emails = [...new Set(paymentDocs.map((p) => p.email))];

        const users = await userCollection
          .find({ email: { $in: emails } })
          .project({ email: 1, displayName: 1, photoURL: 1 })
          .toArray();

        const userMap = {};
        users.forEach((u) => {
          userMap[u.email] = u;
        });

        const participants = paymentDocs.map((p) => {
          const u = userMap[p.email] || {};
          return {
            _id: p._id,
            email: p.email,
            name: u.displayName || p.email,
            photoURL: u.photoURL || null,
          };
        });

        res.send(participants);
      } catch (error) {
        console.error("Get participants error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.delete("/contests/:id", verifyToken,verifyCreatorOrAdmin,async (req, res) => {
        await contestsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });
        res.send({ message: "Contest deleted" });
      }
    );

   
    // app.patch("/payment-success", verifyToken, async (req, res) => {
    //   const sessionId = req.query.session_id;
    //   if (!sessionId)
    //     return res.status(400).send({ message: "session_id required" });

    //   try {
      
    //     const session = await stripe.checkout.sessions.retrieve(sessionId);
    //     if (session.payment_status !== "paid") {
    //       return res.status(400).send({ message: "Payment not completed" });
    //     }

    //     const email = req.decoded_email;
    //     const contestId = session.metadata?.contestId;
    //     const contestName = session.metadata?.name || "Contest";

    //     if (!contestId) {
    //       return res.status(400).send({ message: "Contest ID required" });
    //     }

        
    //     const existingPayment = await paymentsCollection.findOne({
    //       email,
    //       contestId,
    //       paymentStatus: "paid",
    //     });

    //     if (existingPayment) {
    //       return res.send({
    //         message: "Already registered",
    //         transactionId: existingPayment.transactionId,
    //         trackingId: existingPayment.trackingId,
    //       });
    //     }

      
    //     const transactionId = session.payment_intent;
    //     const trackingId = generateTrackingId();

    //     await paymentsCollection.insertOne({
    //       email,
    //       contestId,
    //       contestName,
    //       price: parseInt(session.amount_total) / 100,
    //       paymentStatus: "paid",
    //       transactionId,
    //       trackingId,
    //       createdAt: new Date(),
    //     });

    //     res.send({
    //       message: "Payment confirmed successfully",
    //       transactionId,
    //       trackingId,
    //     });
    //   } catch (error) {
    //     console.error("Payment success error:", error);
    //     res.status(500).send({ message: "Payment confirmation failed" });
    //   }
    // });

    
    app.get("/payments/history/:email", verifyToken, async (req, res) => {
      if (req.params.email !== req.decoded_email) {
        return res.status(403).send({ message: "Forbidden" });
      }

      const history = await paymentsCollection
        .find({ email: req.params.email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(history);
    });

    
    app.post("/create-checkout-session", verifyToken, async (req, res) => {
      const { price, contestId, email, name } = req.body;


      if (!price || !contestId || !email || !name) {
        return res
          .status(400)
          .send({
            message: "Missing required fields: price, contestId, email, name",
          });
      }

      const amount = parseInt(price);
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).send({ message: "Invalid price value" });
      }

      if (!process.env.SITE_DOMAIN) {
        console.error("SITE_DOMAIN env var missing");
        return res.status(500).send({ message: "Server configuration error" });
      }

      try {
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amount * 100, 
                product_data: {
                  name: `Contest Entry: ${name}`,
                },
              },
              quantity: 1,
            },
          ],
          customer_email: email,
          mode: "payment",
          metadata: {
            contestId,
            name,
            email,
          },

          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error("Stripe session creation error:", error);
        res.status(500).send({ message: "Failed to create payment session" });
      }
    });

    // app.patch("/payment-success", verifyToken, async (req, res) => {
    //   const sessionId = req.query.session_id;
    //   if (!sessionId) {
    //     return res.status(400).send({ message: "session_id required" });
    //   }

    //   try {
    //     const session = await stripe.checkout.sessions.retrieve(sessionId, {
    //       expand: ["line_items"],
    //     });

    //     if (session.payment_status !== "paid") {
    //       return res.status(400).send({ message: "Payment not completed" });
    //     }

    //     const email = req.decoded_email;
    //     const contestId = session.metadata?.contestId;
    //     const contestName = session.metadata?.name;

    //     if (!contestId || !contestName) {
    //       return res
    //         .status(400)
    //         .send({ message: "Contest information missing" });
    //     }

    //     const existingPayment = await paymentsCollection.findOne({
    //       email,
    //       contestId,
    //       paymentStatus: "paid",
    //     });

    //     if (existingPayment) {
    //       return res.send({
    //         message: "Already registered for this contest",
    //         transactionId: existingPayment.transactionId,
    //         trackingId: existingPayment.trackingId,
    //       });
    //     }

    //     const contest = await contestsCollection.findOne({
    //       _id: new ObjectId(contestId),
    //     });
    //     if (!contest) {
    //       return res.status(404).send({ message: "Contest not found" });
    //     }

    //     const transactionId = session.payment_intent;
    //     const trackingId = generateTrackingId();
    //     const price = parseInt(session.amount_total) / 100;

    //     const paymentDoc = {
    //       email,
    //       contestId,
    //       contestName,
    //       price,
    //       paymentStatus: "paid",
    //       transactionId,
    //       trackingId,
    //       createdAt: new Date(),
    //     };

    //     await paymentsCollection.insertOne(paymentDoc);

    //     res.send({
    //       message: "Payment confirmed! You're now registered.",
    //       transactionId,
    //       trackingId,
    //       contestId,
    //     });
    //   } catch (error) {
    //     console.error("Payment success error:", error);
    //     res.status(500).send({ message: "Payment confirmation failed" });
    //   }
    // });

   
    app.get("/contests/approved-with-participants", async (req, res) => {
      try {
        const contests = await contestsCollection
          .find({ status: "approved" })
          .toArray();

        const contestIds = contests.map((c) => c._id.toString());

        const payments = await paymentsCollection
          .find({
            contestId: { $in: contestIds },
            paymentStatus: "paid",
          })
          .toArray();

        const emails = [...new Set(payments.map((p) => p.email))];

        const users = await userCollection
          .find({ email: { $in: emails } })
          .project({ email: 1, displayName: 1, photoURL: 1 })
          .toArray();

        const userMap = {};
        users.forEach((u) => {
          userMap[u.email] = u;
        });

        const contestParticipantsMap = {};

        payments.forEach((p) => {
          if (!contestParticipantsMap[p.contestId]) {
            contestParticipantsMap[p.contestId] = [];
          }

          const user = userMap[p.email] || {};

          contestParticipantsMap[p.contestId].push({
            email: p.email,
            name: user.displayName || p.email,
            photoURL: user.photoURL || null,
          });
        });

        const finalContests = contests.map((contest) => ({
          ...contest,
          participants: contestParticipantsMap[contest._id.toString()] || [],
          participantsCount:
            contestParticipantsMap[contest._id.toString()]?.length || 0,
        }));

        res.send(finalContests);
      } catch (error) {
        console.error("Contest fetch error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error(err);
  }
}

run();

app.get("/", (req, res) => {
  res.send("Create Arena Server Running ✅");
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Server running on ${port}`));

