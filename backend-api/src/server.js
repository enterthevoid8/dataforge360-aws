import express from "express";
import cors from "cors";
import helmet from "helmet";
import pino from "pino";
import pinoHttp from "pino-http";
import pg from "pg";
import { KinesisClient, PutRecordCommand } from "@aws-sdk/client-kinesis";

const { Pool } = pg;

const logger = pino({
  level: process.env.LOG_LEVEL || "info"
});

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

const PORT = Number(process.env.PORT || 3000);

const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "dataforge360db",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
};

const pool =
  dbConfig.host && dbConfig.user && dbConfig.password
    ? new Pool(dbConfig)
    : null;

const kinesisClient = new KinesisClient({
  region: process.env.AWS_REGION || "ap-south-1"
});

const kinesisStreamName = process.env.KINESIS_STREAM_NAME;

function requireDb(req, res) {
  if (!pool) {
    res.status(503).json({
      error: "Database is not configured"
    });
    return false;
  }

  return true;
}

function requireAdmin(req, res, next) {
  const expectedToken = process.env.ADMIN_TOKEN;

  if (!expectedToken) {
    return res.status(500).json({
      error: "ADMIN_TOKEN is not configured"
    });
  }

  const providedToken = req.headers["x-admin-token"];

  if (providedToken !== expectedToken) {
    return res.status(401).json({
      error: "Unauthorized admin request"
    });
  }

  next();
}

app.get("/", (req, res) => {
  res.json({
    app: "DataForge360 Backend API",
    status: "running",
    environment: process.env.NODE_ENV || "development"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "dataforge360-backend-api",
    timestamp: new Date().toISOString()
  });
});

app.get("/ready", async (req, res) => {
  if (!requireDb(req, res)) return;

  try {
    const result = await pool.query("SELECT NOW() AS now");

    return res.json({
      status: "ready",
      database: "connected",
      dbTime: result.rows[0].now,
      kinesisConfigured: Boolean(kinesisStreamName),
      kinesisStreamName: kinesisStreamName || null
    });
  } catch (error) {
    req.log.error({ error }, "Database readiness check failed");

    return res.status(503).json({
      status: "not_ready",
      database: "not_connected",
      error: error.message
    });
  }
});

app.post("/api/admin/init-db", requireAdmin, async (req, res) => {
  if (!requireDb(req, res)) return;

  const sql = `
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    CREATE TABLE IF NOT EXISTS customers (
      customer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      city VARCHAR(100),
      state VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      product_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(150) NOT NULL,
      category VARCHAR(100) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      stock_quantity INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      order_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      customer_id UUID REFERENCES customers(customer_id),
      order_status VARCHAR(50) NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL,
      source_channel VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      order_item_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      order_id UUID REFERENCES orders(order_id),
      product_id UUID REFERENCES products(product_id),
      quantity INT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      payment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      order_id UUID REFERENCES orders(order_id),
      payment_method VARCHAR(50),
      payment_status VARCHAR(50),
      amount DECIMAL(10,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_events (
      event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      event_type VARCHAR(100) NOT NULL,
      user_id VARCHAR(100),
      payload JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await pool.query(sql);

  res.json({
    message: "Database schema initialized successfully",
    tables: [
      "customers",
      "products",
      "orders",
      "order_items",
      "payments",
      "app_events"
    ]
  });
});

app.post("/api/admin/seed-data", requireAdmin, async (req, res) => {
  if (!requireDb(req, res)) return;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      INSERT INTO customers (name, email, city, state)
      VALUES
        ('Aarav Sharma', 'aarav.sharma@example.com', 'Jaipur', 'Rajasthan'),
        ('Neha Verma', 'neha.verma@example.com', 'Pune', 'Maharashtra'),
        ('Rahul Mehta', 'rahul.mehta@example.com', 'Noida', 'Uttar Pradesh'),
        ('Priya Nair', 'priya.nair@example.com', 'Bengaluru', 'Karnataka'),
        ('Karan Singh', 'karan.singh@example.com', 'Delhi', 'Delhi')
      ON CONFLICT (email) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO products (name, category, price, stock_quantity)
      VALUES
        ('Wireless Headphones', 'Electronics', 2499.00, 120),
        ('Smart Watch', 'Electronics', 5999.00, 80),
        ('Running Shoes', 'Fashion', 3499.00, 150),
        ('Office Chair', 'Furniture', 8999.00, 45),
        ('Backpack', 'Travel', 1799.00, 200)
      ON CONFLICT DO NOTHING;
    `);

    const customers = await client.query(`
      SELECT customer_id FROM customers ORDER BY created_at ASC LIMIT 5;
    `);

    const products = await client.query(`
      SELECT product_id, price FROM products ORDER BY created_at ASC LIMIT 5;
    `);

    let createdOrders = 0;

    for (let i = 0; i < customers.rows.length; i++) {
      const customer = customers.rows[i];
      const product = products.rows[i % products.rows.length];

      const quantity = i + 1;
      const total = Number(product.price) * quantity;
      const source = ["meta_ads", "google_search", "direct", "influencer", "email"][i % 5];

      const orderResult = await client.query(
        `
        INSERT INTO orders (customer_id, order_status, total_amount, source_channel)
        VALUES ($1, $2, $3, $4)
        RETURNING order_id;
        `,
        [customer.customer_id, "COMPLETED", total, source]
      );

      const orderId = orderResult.rows[0].order_id;

      await client.query(
        `
        INSERT INTO order_items (order_id, product_id, quantity, price)
        VALUES ($1, $2, $3, $4);
        `,
        [orderId, product.product_id, quantity, product.price]
      );

      await client.query(
        `
        INSERT INTO payments (order_id, payment_method, payment_status, amount)
        VALUES ($1, $2, $3, $4);
        `,
        [orderId, "UPI", "SUCCESS", total]
      );

      createdOrders++;
    }

    await client.query("COMMIT");

    res.json({
      message: "Sample ecommerce data seeded successfully",
      createdOrders
    });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ error }, "Seed data failed");

    res.status(500).json({
      error: "Seed data failed",
      details: error.message
    });
  } finally {
    client.release();
  }
});

app.get("/api/customers", async (req, res) => {
  if (!requireDb(req, res)) return;

  const result = await pool.query(`
    SELECT customer_id, name, email, city, state, created_at
    FROM customers
    ORDER BY created_at DESC
    LIMIT 50
  `);

  res.json({
    count: result.rowCount,
    data: result.rows
  });
});

app.get("/api/products", async (req, res) => {
  if (!requireDb(req, res)) return;

  const result = await pool.query(`
    SELECT product_id, name, category, price, stock_quantity, created_at
    FROM products
    ORDER BY name ASC
    LIMIT 50
  `);

  res.json({
    count: result.rowCount,
    data: result.rows
  });
});

app.get("/api/orders", async (req, res) => {
  if (!requireDb(req, res)) return;

  const result = await pool.query(`
    SELECT 
      o.order_id,
      c.name AS customer_name,
      c.city,
      c.state,
      o.order_status,
      o.total_amount,
      o.source_channel,
      o.created_at
    FROM orders o
    JOIN customers c ON o.customer_id = c.customer_id
    ORDER BY o.created_at DESC
    LIMIT 50
  `);

  res.json({
    count: result.rowCount,
    data: result.rows
  });
});

app.post("/api/events", async (req, res) => {
  const event = {
    eventType: req.body.eventType || "UNKNOWN_EVENT",
    userId: req.body.userId || null,
    sessionId: req.body.sessionId || null,
    productId: req.body.productId || null,
    orderId: req.body.orderId || null,
    source: req.body.source || "api",
    payload: req.body,
    receivedAt: new Date().toISOString()
  };

  if (pool) {
    try {
      await pool.query(
        `
        INSERT INTO app_events (event_type, user_id, payload)
        VALUES ($1, $2, $3);
        `,
        [event.eventType, event.userId, event]
      );
    } catch (error) {
      req.log.error({ error }, "Failed to save event in PostgreSQL");
    }
  }

  if (!kinesisStreamName) {
    return res.status(500).json({
      error: "KINESIS_STREAM_NAME is not configured"
    });
  }

  try {
    const partitionKey = event.userId || event.sessionId || "anonymous-user";

    const command = new PutRecordCommand({
      StreamName: kinesisStreamName,
      PartitionKey: partitionKey,
      Data: Buffer.from(JSON.stringify(event) + "\n")
    });

    const result = await kinesisClient.send(command);

    req.log.info(
      {
        eventType: event.eventType,
        partitionKey,
        shardId: result.ShardId
      },
      "Event published to Kinesis"
    );

    return res.status(202).json({
      message: "Event accepted and published to Kinesis",
      event,
      kinesis: {
        streamName: kinesisStreamName,
        shardId: result.ShardId,
        sequenceNumber: result.SequenceNumber
      }
    });
  } catch (error) {
    req.log.error({ error }, "Failed to publish event to Kinesis");

    return res.status(500).json({
      error: "Failed to publish event to Kinesis",
      details: error.message
    });
  }
});

app.get("/api/analytics/revenue-by-state", async (req, res) => {
  if (!requireDb(req, res)) return;

  const result = await pool.query(`
    SELECT 
      c.state,
      COUNT(o.order_id) AS total_orders,
      SUM(o.total_amount) AS revenue
    FROM orders o
    JOIN customers c ON o.customer_id = c.customer_id
    GROUP BY c.state
    ORDER BY revenue DESC;
  `);

  res.json({
    count: result.rowCount,
    data: result.rows
  });
});

app.get("/api/analytics/revenue-by-channel", async (req, res) => {
  if (!requireDb(req, res)) return;

  const result = await pool.query(`
    SELECT 
      source_channel,
      COUNT(order_id) AS total_orders,
      SUM(total_amount) AS revenue
    FROM orders
    GROUP BY source_channel
    ORDER BY revenue DESC;
  `);

  res.json({
    count: result.rowCount,
    data: result.rows
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl
  });
});

app.use((err, req, res, next) => {
  req.log.error({ err }, "Unhandled error");

  res.status(500).json({
    error: "Internal server error"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  logger.info(`DataForge360 Backend API running on port ${PORT}`);
});