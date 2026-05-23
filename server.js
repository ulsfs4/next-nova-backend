require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("./db");
const multer = require("multer");
const path = require("path");

const app = express();
app.use("/uploads", express.static("uploads"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

app.use(cors());
app.use(express.json());


app.post("/api/auth/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const sql = "INSERT INTO users (username,email,password,role) VALUES (?,?,?,?)";
    db.query(sql, [username, email, hashed, "user"], (err, result) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ message: "User created" });
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


app.post("/api/auth/signin", (req, res) => {
  const { email, password } = req.body;
  const sql = "SELECT * FROM users WHERE email=?";
  db.query(sql, [email], async (err, results) => {
    if (err) return res.status(500).json({ message: err.message });
    if (results.length === 0) return res.status(400).json({ message: "User not found" });

    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Wrong password" });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
    });
  });
});




app.post("/api/upload", upload.single("image"), (req, res) => {
  res.json({
    success: true,
    image: req.file.filename,
  });
});



app.get("/api/products", (req, res) => {
  db.query("SELECT * FROM products", (err, results) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json({ success: true, products: results });
  });
});

app.post("/api/products", (req, res) => {
  const { name, description, price, stock, image } = req.body;
  db.query(
    "INSERT INTO products (name, description, price, stock, image) VALUES (?, ?, ?, ?, ?)",
    [name, description, price, stock, image || null],
    (err) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      res.json({ success: true });
    }
  );
});





app.get('/api/orders/user/:user_id', (req, res) => {
  const sql = `
    SELECT o.id, o.total, o.created_at,
      oi.quantity, oi.price as item_price,
      p.name as product_name
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN products p ON oi.product_id = p.id
    WHERE o.user_id = ?
    ORDER BY o.id DESC
  `;
  db.query(sql, [req.params.user_id], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: err.message });

    const ordersMap = {};
    results.forEach((row) => {
      if (!ordersMap[row.id]) {
        ordersMap[row.id] = {
          id: row.id,
          total: row.total,
          created_at: row.created_at,
          items: [],
        };
      }
      if (row.product_name) {
        ordersMap[row.id].items.push({
          name: row.product_name,
          quantity: row.quantity,
          price: row.item_price,
        });
      }
    });

    res.json({ success: true, orders: Object.values(ordersMap) });
  });
});








app.get('/api/products/search', (req, res) => {
  const { q } = req.query;
  db.query(
    'SELECT * FROM products WHERE name LIKE ?',
    [`%${q}%`],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      res.json({ success: true, products: results });
    }
  );
});





app.get('/api/products/category/:category', (req, res) => {
  db.query(
    'SELECT * FROM products WHERE category = ?',
    [req.params.category],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      res.json({ success: true, products: results });
    }
  );
});













app.delete("/api/products/:id", (req, res) => {
  db.query("DELETE FROM products WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json({ success: true });
  });
});

app.put("/api/products/:id/decrease-stock", (req, res) => {
  const sql = "UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0";
  db.query(sql, [req.params.id], (err) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json({ success: true });
  });
});



app.post("/api/orders", (req, res) => {
  const { user_id, cart, total } = req.body;

  db.query(
    "INSERT INTO orders (user_id, total) VALUES (?, ?)",
    [user_id, total],
    (err, result) => {
      if (err) return res.status(500).json({ success: false, message: err.message });

      const order_id = result.insertId;
      const items = cart.map((item) => [order_id, item.id, item.quantity, item.price]);

      db.query(
        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ?",
        [items],
        (err2) => {
          if (err2) return res.status(500).json({ success: false, message: err2.message });
          res.json({ success: true, order_id });
        }
      );
    }
  );
});

app.get("/api/orders", (req, res) => {
  const sql = `
    SELECT o.id, o.total, o.created_at, u.username,
      oi.quantity, oi.price as item_price,
      p.name as product_name
    FROM orders o
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN products p ON oi.product_id = p.id
    ORDER BY o.id DESC
  `;

  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ success: false, message: err.message });

    const ordersMap = {};
    results.forEach((row) => {
      if (!ordersMap[row.id]) {
        ordersMap[row.id] = {
          id: row.id,
          total: row.total,
          created_at: row.created_at,
          username: row.username,
          items: [],
        };
      }
      if (row.product_name) {
        ordersMap[row.id].items.push({
          product_name: row.product_name,
          quantity: row.quantity,
          price: row.item_price,
        });
      }
    });

    res.json({ success: true, orders: Object.values(ordersMap) });
  });
});



app.get("/", (req, res) => res.send("API running..."));

app.listen(process.env.PORT, () => {
  console.log("Server running on port", process.env.PORT);
});