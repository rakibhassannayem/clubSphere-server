require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 3000;

// const serviceAccount = require("./clubsphere-firebase-adminsdk.json");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

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
    const eventsCollection = db.collection("events");
    const registrationsCollection = db.collection("eventRegistrations");
    const paymentsCollection = db.collection("payments");

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

    /**
 * Backend Middleware: blocks write operations for demo accounts
 */
    const verifyDemo = (req, res, next) => {
      const demoEmails = [
        "admin@sphere.com",
        "manager@sphere.com",
        "member@sphere.com",
      ];

      const email = req.token_email;

      if (email && demoEmails.includes(email)) {
        if (req.method !== "GET") {
          return res.send({
            success: false,
            isDemo: true,
            message: "Demo Mode: You can view the UI but cannot modify data.",
          });
        }
      }
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

    app.get("/clubs", async (req, res) => {
      const { search, category, sort } = req.query;

      const query = {
        status: "approved",
      };

      // Search
      if (search) {
        query.clubName = { $regex: search, $options: "i" };
      }

      // Filter
      if (category) {
        query.category = category;
      }

      let sortQuery = {};

      // Sorting
      if (sort === "mostMembers") {
        sortQuery = { members: -1 };
      } else if (sort === "lowestFee") {
        sortQuery = { membershipFee: 1 };
      } else if (sort === "highestFee") {
        sortQuery = { membershipFee: -1 };
      }

      const result = await clubsCollection
        .find(query)
        .sort(sortQuery)
        .toArray();

      res.send(result);
    });

    app.get("/clubs/:id", async (req, res) => {
      const id = req.params.id;
      const result = await clubsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Events related APIs
    app.get("/events", async (req, res) => {
      const { search, category, sort } = req.query;

      const query = {};

      // Search
      if (search) {
        query.eventTitle = { $regex: search, $options: "i" };
      }

      // Filter
      if (category) {
        query.category = category;
      }

      let sortQuery = {};

      // Sorting
      if (sort === "mostMembers") {
        sortQuery = { registrations: -1 };
      } else if (sort === "lowestFee") {
        sortQuery = { eventFee: 1 };
      } else if (sort === "highestFee") {
        sortQuery = { eventFee: -1 };
      }

      const result = await eventsCollection
        .find(query)
        .sort(sortQuery)
        .toArray();

      res.send(result);
    });

    app.get("/upcoming-events", async (req, res) => {
      const today = new Date().toISOString();

      const result = await eventsCollection
        .find({ eventDate: { $gte: today } })
        .limit(6)
        .toArray();

      res.send(result);
    });

    app.get("/events/:id", async (req, res) => {
      const id = req.params.id;
      const result = await eventsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    app.get("/userCount", async (req, res) => {
      const result = await usersCollection.countDocuments();
      res.send(result);
    })

    // admin ony APIs
    app.get("/users", verifyJwtToken, verifyAdmin, async (req, res) => {
      const adminEmail = req.token_email;
      const cursor = usersCollection.find({ email: { $ne: adminEmail } });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get(
      "/admin/overview",
      verifyJwtToken,
      verifyAdmin,
      async (req, res) => {
        const totalUsers = await usersCollection.countDocuments();
        const totalClubs = await clubsCollection.countDocuments();
        const totalMemberships = await memberShipsCollection.countDocuments();

        const pendingClubs = await clubsCollection.countDocuments({
          status: "pending",
        });

        const totalEvents = await eventsCollection.countDocuments();

        const revenueResult = await paymentsCollection
          .aggregate([
            {
              $group: {
                _id: null,
                total: { $sum: "$amount" },
              },
            },
          ])
          .toArray();

        const revenue = revenueResult[0]?.total || 0;

        res.send({
          totalUsers,
          totalClubs,
          totalMemberships,
          pendingClubs,
          totalEvents,
          revenue,
        });
      }
    );

    app.get("/admin-clubs", verifyJwtToken, verifyAdmin, async (req, res) => {
      const cursor = clubsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/payments", verifyJwtToken, verifyAdmin, async (req, res) => {
      const cursor = paymentsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.patch("/update-role", verifyJwtToken, verifyDemo, verifyAdmin, async (req, res) => {
      const { email, role } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { role } }
      );

      res.send(result);
    });

    app.patch(
      "/update-club-status",
      verifyJwtToken,
      verifyDemo,
      verifyAdmin,
      async (req, res) => {
        const { id, status } = req.body;
        const result = await clubsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        res.send(result);
      }
    );

    // manager only APIs
    app.get(
      "/manager/overview",
      verifyJwtToken,
      verifyMananger,
      async (req, res) => {
        const managerEmail = req.token_email;

        const myClubs = await clubsCollection.countDocuments({
          managerEmail,
        });
        const totalMembers = await memberShipsCollection.countDocuments({
          managerEmail,
        });
        const totalEvents = await eventsCollection.countDocuments({
          managerEmail,
        });

        let revenue = 0;
        const hasPayment = await paymentsCollection.findOne({ managerEmail });
        if (hasPayment) {
          const revenueResult = await paymentsCollection
            .aggregate([
              {
                $match: { managerEmail },
              },
              {
                $group: {
                  _id: null,
                  totalAmount: { $sum: "$amount" },
                },
              },
            ])
            .toArray();
          revenue = revenueResult[0]?.totalAmount || 0;
        }

        res.send({
          myClubs,
          totalMembers,
          totalEvents,
          revenue,
        });
      }
    );

    app.post("/clubs", verifyJwtToken, verifyDemo, verifyMananger, async (req, res) => {
      const club = req.body;
      const result = await clubsCollection.insertOne(club);
      res.send(result);
    });

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

    app.patch(
      "/clubs/:id",
      verifyJwtToken,
      verifyDemo,
      verifyMananger,
      async (req, res) => {
        const query = { _id: new ObjectId(req.params.id) };
        const updatedDoc = req.body;
        const result = await clubsCollection.updateOne(query, {
          $set: updatedDoc,
        });

        res.send(result);
      }
    );

    app.get(
      "/club-members",
      verifyJwtToken,
      verifyMananger,
      async (req, res) => {
        const managerEmail = req.token_email;

        const result = await memberShipsCollection
          .find({ managerEmail })
          .toArray();

        res.send(result);
      }
    );

    app.patch(
      "/update-member-status",
      verifyJwtToken,
      verifyDemo,
      verifyMananger,
      async (req, res) => {
        const { id, status } = req.body;
        const result = await memberShipsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        res.send(result);
      }
    );

    app.post("/events", verifyJwtToken, verifyDemo, verifyMananger, async (req, res) => {
      const event = req.body;
      const result = await eventsCollection.insertOne(event);

      if (result.acknowledged) {
        await clubsCollection.updateOne(
          { _id: new ObjectId(event.clubId) },
          {
            $inc: {
              events: 1,
            },
          }
        );
      }
      res.send(result);
    });

    app.get(
      "/manager-events",
      verifyJwtToken,
      verifyMananger,
      async (req, res) => {
        const managerEmail = req.token_email;

        const result = await eventsCollection.find({ managerEmail }).toArray();

        res.send(result);
      }
    );

    app.patch(
      "/events/:id",
      verifyJwtToken,
      verifyDemo,
      verifyMananger,
      async (req, res) => {
        const query = { _id: new ObjectId(req.params.id) };
        const updatedDoc = req.body;
        const result = await eventsCollection.updateOne(query, {
          $set: updatedDoc,
        });

        res.send(result);
      }
    );

    app.delete(
      "/events/:id",
      verifyJwtToken,
      verifyDemo,
      verifyMananger,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const result = await eventsCollection.deleteOne(query);

        res.send(result);
      }
    );

    app.get(
      "/registered-members",
      verifyJwtToken,
      verifyMananger,
      async (req, res) => {
        const managerEmail = req.token_email;

        const result = await registrationsCollection
          .find({ managerEmail })
          .toArray();

        res.send(result);
      }
    );

    // members APIs
    app.get(
      "/member/overview",
      verifyJwtToken,
      verifyMember,
      async (req, res) => {
        const memberEmail = req.token_email;

        const totalClubs = await memberShipsCollection.countDocuments({
          memberEmail,
        });

        const totalEvents = await registrationsCollection.countDocuments({
          memberEmail,
        });

        res.send({
          totalClubs,
          totalEvents,
        });
      }
    );

    app.get("/member-clubs", verifyJwtToken, verifyMember, async (req, res) => {
      const memberEmail = req.token_email;

      const result = await memberShipsCollection
        .aggregate([
          {
            $match: { memberEmail },
          },
          {
            $addFields: {
              clubObjectId: { $toObjectId: "$clubId" },
            },
          },
          {
            $lookup: {
              from: "clubs",
              localField: "clubObjectId",
              foreignField: "_id",
              as: "club",
            },
          },
          {
            $unwind: "$club",
          },
          {
            $replaceRoot: { newRoot: "$club" },
          },
        ])
        .toArray();

      res.send(result);
    });

    app.get(
      "/member-payments",
      verifyJwtToken,
      verifyMember,
      async (req, res) => {
        const memberEmail = req.token_email;

        const result = await paymentsCollection.find({ memberEmail }).toArray();

        res.send(result);
      }
    );

    app.get(
      "/member-events",
      verifyJwtToken,
      verifyMember,
      async (req, res) => {
        const memberEmail = req.token_email;

        const result = await registrationsCollection
          .aggregate([
            {
              $match: { memberEmail },
            },
            {
              $addFields: {
                eventObjectId: { $toObjectId: "$eventId" },
              },
            },
            {
              $lookup: {
                from: "events",
                localField: "eventObjectId",
                foreignField: "_id",
                as: "event",
              },
            },
            {
              $unwind: "$event",
            },
            {
              $replaceRoot: { newRoot: "$event" },
            },
          ])
          .toArray();

        res.send(result);
      }
    );

    app.get("/is-member/:clubId", verifyJwtToken, async (req, res) => {
      const { clubId } = req.params;
      const memberEmail = req.token_email;

      const exists = await memberShipsCollection.findOne({
        clubId,
        memberEmail,
      });

      res.send({ isMember: !!exists });
    });

    app.get("/is-registered/:eventId", verifyJwtToken, async (req, res) => {
      const { eventId } = req.params;
      const memberEmail = req.token_email;

      const exists = await registrationsCollection.findOne({
        eventId,
        memberEmail,
      });

      res.send({ isRegistered: !!exists });
    });

    app.post(
      "/free-membership",
      verifyJwtToken,
      verifyDemo,
      verifyMember,
      async (req, res) => {
        const freeInfo = req.body;

        const result = await memberShipsCollection.insertOne(freeInfo);
        if (result.acknowledged) {
          await clubsCollection.updateOne(
            { _id: new ObjectId(freeInfo.clubId) },
            {
              $inc: {
                members: 1,
              },
            }
          );
        }
        res.send(result);
      }
    );

    app.post(
      "/free-registration",
      verifyJwtToken,
      verifyDemo,
      verifyMember,
      async (req, res) => {
        const freeInfo = req.body;

        const result = await registrationsCollection.insertOne(freeInfo);
        if (result.acknowledged) {
          await eventsCollection.updateOne(
            { _id: new ObjectId(freeInfo.eventId) },
            {
              $inc: {
                registrations: 1,
              },
            }
          );
        }
        res.send(result);
      }
    );

    // Payments related APIs
    app.post("/create-checkout-session", verifyJwtToken, verifyDemo, async (req, res) => {
      try {
        const {
          paymentType,
          clubId,
          eventId,
          clubName,
          eventTitle,
          description,
          bannerImage,
          amount,
          member,
          managerEmail,
        } = req.body;

        if (!paymentType || !amount || !member?.email) {
          return res.status(400).send({ message: "Invalid payment data" });
        }

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: paymentType === "membership" ? clubName : eventTitle,
                  description,
                  images: bannerImage ? [bannerImage] : [],
                },
                unit_amount: amount * 100,
              },
              quantity: 1,
            },
          ],

          customer_email: member?.email,
          mode: "payment",

          metadata: {
            paymentType,
            clubId,
            eventId: eventId || "",
            memberEmail: member.email,
            memberName: member.name,
            managerEmail,
            clubName,
            eventTitle,
          },

          success_url: `${process.env.CLIENT_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url:
            paymentType === "membership"
              ? `${process.env.CLIENT_DOMAIN}/dashboard/club-details/${clubId}`
              : `${process.env.CLIENT_DOMAIN}/dashboard/event-details/${eventId}`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error("Stripe Error:", error);
        res.status(500).send({ message: "Failed to create checkout session" });
      }
    });

    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.status !== "complete") {
        return res.send({ success: false });
      }

      const {
        paymentType,
        clubId,
        clubName,
        eventId,
        eventTitle,
        memberEmail,
        memberName,
        managerEmail,
      } = session.metadata;

      const transactionId = session.payment_intent;

      // prevent duplicate payments
      const paymentDuplicate = await paymentsCollection.findOne({
        transactionId,
      });
      if (!paymentDuplicate) {
        await paymentsCollection.insertOne({
          paymentType,
          amount: session.amount_total / 100,
          transactionId,
          memberEmail,
          memberName,
          managerEmail,
          clubName,
          clubId,
          eventId: eventId ? eventId : null,
          status: "success",
          paidAt: new Date(),
        });
      }

      if (paymentType === "membership") {
        await clubsCollection.updateOne(
          { _id: new ObjectId(clubId) },
          {
            $inc: {
              members: 1,
            },
          }
        );

        // prevent duplicate membership
        const membershipDuplicate = await memberShipsCollection.findOne({
          transactionId,
        });
        if (!membershipDuplicate) {
          await memberShipsCollection.insertOne({
            clubId,
            transactionId,
            memberEmail,
            memberName,
            status: "active",
            managerEmail: managerEmail,
            clubName,
            joinedAt: new Date(),
          });
        }
      }

      if (paymentType === "eventFee") {
        await eventsCollection.updateOne(
          { _id: new ObjectId(eventId) },
          { $inc: { registrations: 1 } }
        );

        // prevent duplicate registration
        const registrationDuplicate = await registrationsCollection.findOne({
          transactionId,
        });

        if (!registrationDuplicate) {
          await registrationsCollection.insertOne({
            eventId,
            eventTitle,
            clubId,
            clubName,
            memberEmail,
            memberName,
            managerEmail,
            transactionId,
            status: "registered",
            registeredAt: new Date(),
          });
        }
      }
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

    app.get("/user/role", verifyJwtToken, async (req, res) => {
      const email = req.query.email;

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
