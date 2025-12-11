require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;

const serviceAccount = require("./clubsphere-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  console.log("headers in the middleware: ", req.headers.authorization);
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    req.decoded_email = decoded.email;

    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
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

    // Clubs related APIs
    app.get("/clubs", async (req, res) => {
      const email = req.query.email;
      const query = {};

      // console.log('headers-----', req.headers)

      if (email) {
        query.managerEmail = email;
      }

      const options = { sort: { members: -1 } };

      // check email address
      if (email !== req.decoded_email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const cursor = clubsCollection.find(query, options);
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
    app.get("/manager-clubs/:email", async (req, res) => {
      const email = req.params.email;

      const result = await clubsCollection
        .find({ managerEmail: email })
        .toArray();

      res.send(result);
    });

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

    // get user's role
    app.get("/user/role/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      
      res.send({ role: result?.role });
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
