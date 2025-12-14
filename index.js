require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 3000;

const serviceAccount = require("./clubsphere-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(express.json());
app.use(cors());

const verifyJwtToken = async (req, res, next) => {
  const authorization = req?.headers?.authorization;
  if (!authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const token = authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorized access" });
    }

    req.token_email = decoded.email;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.8vhjke1.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const db = client.db("clubSphere_db");
    const usersCollection = db.collection("users");
    const clubsCollection = db.collection("clubs");
    const memberShipsCollection = db.collection("memberShips");

    // Role based middlewares
    const verifyAdmin = async (req, res, next) => {
      const email = req.token_email;
      const user = await usersCollection.findOne({ email });

      if (!user || user?.role !== "admin")
        return res
          .status(403)
          .send({ message: "Admin only actions!", role: user?.role });

      next();
    };

    const verifyMananger = async (req, res, next) => {
      const email = req.token_email;
      const user = await usersCollection.findOne({ email });

      if (!user || user?.role !== "manager")
        return res
          .status(403)
          .send({ message: "Manager only actions!", role: user?.role });

      next();
    };

    const verifyMember = async (req, res, next) => {
      const email = req.token_email;
      const user = await usersCollection.findOne({ email });

      if (!user || user?.role !== "member")
        return res
          .status(403)
          .send({ message: "Member only actions!", role: user?.role });

      next();
    };

    // JWT token generation and send to client
    app.post("/getJwtToken", (req, res) => {
      loggedUser = req.body;
      const token = jwt.sign(loggedUser, process.env.JWT_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token: token });
    });

    // Clubs related APIs
    app.get("/clubs", async (req, res) => {
      const cursor = clubsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/clubs/:id", async (req, res) => {
      const id = req.params.id;
      const result = await clubsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.post("/clubs", async (req, res) => {
      const club = req.body;
      const result = await clubsCollection.insertOne(club);
      res.send(result);
    });

    // admin APIs
    app.get(
      "/admin/overview",
      verifyJwtToken,
      verifyAdmin,
      async (req, res) => {
        const totalUsers = await usersCollection.estimatedDocumentCount();
        const totalClubs = await clubsCollection.estimatedDocumentCount();

        const activeMembers = await memberShipsCollection.countDocuments({
          status: "active",
        });

        const pendingClubs = await clubsCollection.countDocuments({
          status: "pending",
        });

        // const totalEvents = await eventsCollection.estimatedDocumentCount();

        // const revenueResult = await paymentsCollection
        //   .aggregate([
        //     {
        //       $group: {
        //         _id: null,
        //         total: { $sum: "$amount" },
        //       },
        //     },
        //   ])
        //   .toArray();

        // const revenue = revenueResult[0]?.total || 0;

        res.send({
          totalUsers,
          totalClubs,
          activeMembers,
          pendingClubs,
          // totalEvents,
          // revenue,
        });
      }
    );

    // members APIs
    app.get("/member-clubs/:email", async (req, res) => {
      const email = req.params.email;

      const club = await memberShipsCollection
        .find({ memberEmail: email })
        .toArray();
      const clubId = club[0].clubId;

      const result = await clubsCollection
        .find({ _id: new ObjectId(clubId) })
        .toArray();
      res.send(result);
    });

    // managers APIs
    app.get(
      "/manager-clubs",
      verifyJwtToken,
      verifyMananger,
      async (req, res) => {
        const email = req.query.email;
        const query = {};

        if (email) {
          query.managerEmail = email;
        }

        // check email address
        if (email !== req.token_email) {
          return res.status(403).send({ message: "forbidden access" });
        }

        const cursor = clubsCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
      }
    );

    app.get("/club-members/:email", async (req, res) => {
      const email = req.params.email;

      const result = await memberShipsCollection
        .find({ managerEmail: email })
        .toArray();

      res.send(result);
    });

    // Payments related APIs
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo?.clubName,
                description: paymentInfo?.description,
                images: [paymentInfo?.bannerImage],
              },
              unit_amount: paymentInfo?.membershipFee * 100,
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo?.member?.email,
        mode: "payment",
        metadata: {
          clubId: paymentInfo?.clubId,
          memberEmail: paymentInfo?.member.email,
          memberName: paymentInfo?.member.name,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard/club-details/${paymentInfo?.clubId}`,
      });
      res.send({ url: session.url });
    });

    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const club = await clubsCollection.findOne({
        _id: new ObjectId(session.metadata.clubId),
      });
      const joinReqDuplicate = await memberShipsCollection.findOne({
        transactionId: session.payment_intent,
      });

      if (session.status === "complete" && club && !joinReqDuplicate) {
        const joinReqInfo = {
          clubId: session.metadata.clubId,
          transactionId: session.payment_intent,
          memberEmail: session.metadata.memberEmail,
          memberName: session.metadata.memberName,
          status: "active",
          managerEmail: club.managerEmail,
          clubName: club.clubName,
          category: club.category,
          joinedAt: new Date(),
        };
        const result = memberShipsCollection.insertOne(joinReqInfo);
      }

      res.send({ success: false });
    });

    // users API
    app.post("/user", async (req, res) => {
      const userData = req.body;
      userData.role = "member";
      userData.createdAt = new Date();
      const email = userData.email;
      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "User Already Exists" });
      }

      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });

    app.get("/users", verifyJwtToken, async (req, res) => {
      const adminEmail = req.token_email;
      const cursor = usersCollection.find({ email: { $ne: adminEmail } });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/user/role", verifyJwtToken, async (req, res) => {
      const email = req.query.email;

      const result = await usersCollection.findOne({ email });

      res.send({ role: result?.role });
    });

    app.patch("/update-role", async (req, res) => {
      const { email, role } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { role } }
      );

      res.send(result);
    });

    app.patch("/update-status", async (req, res) => {
      const { id, status } = req.body;
      const result = await clubsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );

      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("ClubSphere is clubing....");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
