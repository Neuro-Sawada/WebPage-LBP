const pool = require("./db");
const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.set("trust proxy", 1);

app.use(session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24
    }
}));

function requireLogin(req, res, next) {
    if (!req.session.loggedIn) {
        req.session.redirectTo = req.originalUrl;
        return res.redirect("/login");
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.loggedIn) {
        req.session.redirectTo = "/admin";
        return res.redirect("/login");
    }

    if (!req.session.isAdmin) {
        return res.redirect("/user");
    }

    next();
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public/index.html"));
});

app.get("/contact", (req, res) => {
    res.sendFile(path.join(__dirname, "public/contact.html"));
});

app.get("/about", (req, res) => {
    res.sendFile(path.join(__dirname, "public/about.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public/login.html"));
});

app.get("/sign_up", (req, res) => {
    res.sendFile(path.join(__dirname, "public/sign_up.html"));
});

app.post("/signup", async (req, res) => {
    const { first_name, last_name, email, phone_number, password } = req.body;

    try {
        const [existing] = await pool.query(
            "SELECT id FROM users WHERE email = ?",
            [email]
        );

        if (existing.length > 0) {
            return res.send("User already exists");
        }

        await pool.query(
            `INSERT INTO users (first_name, last_name, email, phone_number, password)
            VALUES (?, ?, ?, ?, ?)`,
                         [first_name, last_name, email, phone_number, password]
        );

        res.redirect("/login");
    } catch (err) {
        console.error("Signup error:", err);
        res.status(500).send("Database error");
    }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        const [rows] = await pool.query(
            "SELECT * FROM users WHERE email = ? AND password = ?",
            [email, password]
        );

        if (rows.length === 0) {
            return res.send("Invalid credentials");
        }

        const user = rows[0];

        req.session.loggedIn = true;
        req.session.username = user.first_name;
        req.session.fullName = `${user.first_name} ${user.last_name}`;
        req.session.userEmail = user.email;
        req.session.userId = user.id;
        req.session.isAdmin = !!user.is_admin;

        const redirectTo = req.session.redirectTo || "/user";
        req.session.redirectTo = null;

        return res.redirect(redirectTo);
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).send("Database error");
    }
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/");
    });
});

app.get("/current-user", (req, res) => {
    if (req.session.loggedIn) {
        return res.json({
            loggedIn: true,
            username: req.session.username,
            fullName: req.session.fullName,
            email: req.session.userEmail,
            isAdmin: !!req.session.isAdmin
        });
    }

    res.json({
        loggedIn: false,
        isAdmin: false
    });
});

app.get("/user", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "public/user.html"));
});

app.get("/user-data", requireLogin, async (req, res) => {
    try {
        const [projectRows] = await pool.query(
            `SELECT status, quote_price, appointment_date, summary
            FROM project_status
            WHERE user_id = ?
            ORDER BY updated_at DESC
            LIMIT 1`,
            [req.session.userId]
        );

        const [quoteRows] = await pool.query(
            `SELECT
            q.id,
            q.appointment_date,
            q.description,
            q.quote_price,
            q.created_at,
            GROUP_CONCAT(
                CONCAT(
                    qr.room_name,
                    ' | ',
                    COALESCE(qr.paint_type, 'No paint type'),
                       ' | ',
                       COALESCE(qr.room_color, 'No color'),
                       ' | ',
                       COALESCE(qr.room_size, 0),
                       ' sq ft',
                       ' | ',
                       COALESCE(qr.room_description, 'No room description')
                )
                ORDER BY qr.id
                SEPARATOR ' || '
            ) AS rooms
            FROM quotes q
            LEFT JOIN quote_rooms qr ON q.id = qr.quote_id
            WHERE q.user_id = ?
            GROUP BY
            q.id,
            q.appointment_date,
            q.description,
            q.quote_price,
            q.created_at
            ORDER BY q.created_at DESC`,
            [req.session.userId]
        );

        const project = projectRows[0] || {
            status: "No project yet",
            quote_price: null,
            appointment_date: null,
            summary: "No quote submitted yet"
        };

        res.json({
            username: req.session.username,
            fullName: req.session.fullName,
            email: req.session.userEmail,
            isAdmin: !!req.session.isAdmin,
            project,
            quotes: quoteRows
        });
    } catch (err) {
        console.error("User data error:", err);
        res.status(500).json({ error: "Database error" });
    }
});

app.get("/quote", requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, "public/quote.html"));
});

app.post("/quote", requireLogin, async (req, res) => {
    const {
        appointment_date,
        description,
        quote_price,
        room_name,
        room_color,
        room_size,
        paint_type,
        room_description
    } = req.body;

    try {
        const [quoteResult] = await pool.query(
            `INSERT INTO quotes (user_id, appointment_date, description, quote_price)
            VALUES (?, ?, ?, ?)`,
                                               [
                                                   req.session.userId,
                                               appointment_date || null,
                                               description || null,
                                               quote_price || null
                                               ]
        );

        const quoteId = quoteResult.insertId;

        const roomNames = Array.isArray(room_name) ? room_name : [room_name];
        const roomColors = Array.isArray(room_color) ? room_color : [room_color];
        const roomSizes = Array.isArray(room_size) ? room_size : [room_size];
        const paintTypes = Array.isArray(paint_type) ? paint_type : [paint_type];
        const roomDescriptions = Array.isArray(room_description) ? room_description : [room_description];

        let summaryParts = [];

        for (let i = 0; i < roomNames.length; i++) {
            if (!roomNames[i]) continue;

            await pool.query(
                `INSERT INTO quote_rooms
                (quote_id, room_name, paint_type, room_color, room_size, room_description)
                VALUES (?, ?, ?, ?, ?, ?)`,
                             [
                                 quoteId,
                             roomNames[i] || null,
                             paintTypes[i] || null,
                             roomColors[i] || null,
                             roomSizes[i] || null,
                             roomDescriptions[i] || null
                             ]
            );

            summaryParts.push(
                `${roomNames[i]} (${paintTypes[i] || "No paint type"}, ${roomSizes[i] || 0} sq ft, ${roomColors[i] || "No color"})`
            );
        }

        const summary = summaryParts.length > 0
        ? summaryParts.join(", ")
        : "No room details";

        await pool.query(
            `INSERT INTO project_status (user_id, status, quote_price, appointment_date, summary)
            VALUES (?, ?, ?, ?, ?)`,
                         [
                             req.session.userId,
                         "Quote Submitted",
                         quote_price || null,
                         appointment_date || null,
                         summary
                         ]
        );

        res.redirect("/thankyou.html");
    } catch (err) {
        console.error("Quote insert error:", err);
        res.status(500).send("Database error");
    }
});

app.get("/admin", requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, "public/adminPage.html"));
});

app.get("/quotes", requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT
            q.id,
            q.user_id,
            q.appointment_date,
            q.description,
            q.quote_price,
            q.created_at,
            u.first_name,
            u.last_name,
            u.email,
            u.phone_number,
            GROUP_CONCAT(
                CONCAT(
                    qr.room_name,
                    ' | ',
                    COALESCE(qr.paint_type, 'No paint type'),
                       ' | ',
                       COALESCE(qr.room_color, 'No color'),
                       ' | ',
                       COALESCE(qr.room_size, 0),
                       ' sq ft',
                       ' | ',
                       COALESCE(qr.room_description, 'No room description')
                )
                ORDER BY qr.id
                SEPARATOR ' || '
            ) AS rooms
            FROM quotes q
            JOIN users u ON q.user_id = u.id
            LEFT JOIN quote_rooms qr ON q.id = qr.quote_id
            GROUP BY
            q.id,
            q.user_id,
            q.appointment_date,
            q.description,
            q.quote_price,
            q.created_at,
            u.first_name,
            u.last_name,
            u.email,
            u.phone_number
            ORDER BY q.created_at DESC`
        );

        res.json(rows);
    } catch (err) {
        console.error("Quotes fetch error:", err);
        res.status(500).json({ error: "Database error" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
