import express, { Request, Response } from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();
const app = express();
const port = process.env.PORT || 4242;

// Initialize Stripe with proper error handling
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  throw new Error('STRIPE_SECRET_KEY environment variable is required');
}

const stripe = new Stripe(stripeSecretKey);

// CPanel email transporter configuration
const getTransporter = () => {
  const config = {
    host: process.env.SMTP_HOST || 'adisaolashile.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE === 'true' || true, // Use SSL for port 465
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      // Do not fail on invalid certificates
      rejectUnauthorized: false
    }
  };

  console.log('SMTP Config:', {
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.auth.user
  });

  return nodemailer.createTransport(config);
};

// Add CORS for frontend URL
const allowedOrigins = [
  "http://localhost:5173",
  process.env.FRONTEND_URL, // e.g. https://your-frontend.vercel.app
].filter(Boolean) as string[];

app.use(
  cors({
    origin: (origin, cb) => {
      // allow requests with no origin (Postman, curl)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());
app.use(express.json());

// Define proper TypeScript interfaces
interface CartItem {
  title: string;
  price: number;
  quantity: number;
}

interface CreateCheckoutSessionRequest {
  items: CartItem[];
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  currency: string;
  currencyMultiplier: number;
}

interface SendReceiptRequest {
  customerEmail: string;
  orderId: string;
  items: CartItem[];
  total: number;
  customerName: string;
  shippingAddress: string;
}

// NEW: Contact form interface
interface ContactFormRequest {
  name: string;
  email: string;
  subject: string;
  message: string;
}

// ========== CONTACT FORM ENDPOINT ==========
app.post('/api/contact', async (req: Request<object, object, ContactFormRequest>, res: Response) => {
  try {
    const { name, email, subject, message } = req.body;

    // Validation
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ 
        success: false,
        error: 'All fields are required' 
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid email address' 
      });
    }

    // Check email configuration
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('Email configuration missing');
      return res.status(500).json({ 
        success: false,
        error: 'Email service is not configured' 
      });
    }

    // Create transporter for each request
    const transporter = getTransporter();

    // Test the connection
    try {
      await transporter.verify();
      console.log('SMTP connection verified successfully');
    } catch (verifyError) {
      console.error('SMTP connection failed:', verifyError);
      return res.status(500).json({ 
        success: false,
        error: 'Email service temporarily unavailable. Please try again later.' 
      });
    }

    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;

    // Email to admin
    const adminMailOptions = {
      from: `"Adisa Olashile Contact Form" <${process.env.EMAIL_USER}>`,
      to: adminEmail,
      subject: `New Contact Form: ${subject}`,
      replyTo: email,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #f8f9fa; padding: 20px; text-align: center; border-bottom: 3px solid #4CAF50; }
            .message-details { background: #fff; padding: 25px; border: 1px solid #ddd; border-radius: 5px; margin-top: 20px; }
            .field { margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #eee; }
            .field-label { font-weight: bold; color: #2c3e50; font-size: 16px; margin-bottom: 5px; }
            .field-value { color: #333; font-size: 15px; }
            .message-content { white-space: pre-wrap; padding: 15px; background: #f9f9f9; border-radius: 5px; border-left: 4px solid #4CAF50; margin-top: 10px; font-size: 15px; line-height: 1.8; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; color: #2c3e50;">📧 New Contact Form Submission</h1>
            </div>
            <div class="message-details">
              <div class="field">
                <div class="field-label">👤 From:</div>
                <div class="field-value">${name} (${email})</div>
              </div>
              <div class="field">
                <div class="field-label">📌 Subject:</div>
                <div class="field-value">${subject}</div>
              </div>
              <div class="field">
                <div class="field-label">💬 Message:</div>
                <div class="message-content">${message}</div>
              </div>
              <div class="footer">
                <p>📅 Received: ${new Date().toLocaleString()}</p>
                <p>💡 <strong>Action:</strong> Click "Reply" in your email client to respond to ${name}.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
NEW CONTACT FORM SUBMISSION
===========================

From: ${name} (${email})
Subject: ${subject}
Received: ${new Date().toLocaleString()}

MESSAGE:
${message}

---
ACTION REQUIRED: Reply directly to this email to respond to ${name}.
      `
    };

    // Email to user (confirmation)
    const userMailOptions = {
      from: `"Adisa Olashile" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Thank You for Contacting Adisa Olashile!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #fff; padding: 30px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 10px 10px; }
            .message-box { background: #f8f9fa; padding: 20px; border-left: 4px solid #4CAF50; margin: 20px 0; border-radius: 5px; }
            .contact-info { background: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0; }
            .social-links { text-align: center; margin-top: 30px; }
            .social-icon { display: inline-block; margin: 0 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 28px;">Thank You, ${name}!</h1>
              <p style="margin: 10px 0 0; opacity: 0.9;">Your message has been received</p>
            </div>
            <div class="content">
              <p>Dear ${name},</p>
              <p>Thank you for contacting <strong>Adisa Olashile</strong>. We have received your message and will respond as soon as possible, typically within 24-48 hours.</p>
              
              <div class="message-box">
                <p style="margin: 0 0 10px; font-weight: bold; color: #2c3e50;">📝 Your Message Summary:</p>
                <p style="margin: 0; color: #555;"><strong>Subject:</strong> ${subject}</p>
                <p style="margin: 10px 0 0; white-space: pre-wrap; padding: 10px; background: white; border-radius: 3px;">${message}</p>
              </div>
              
              <div class="contact-info">
                <p style="margin: 0 0 10px; font-weight: bold; color: #1565c0;">📞 Our Contact Information:</p>
                <p style="margin: 5px 0;"><strong>Phone:</strong> +44 7887 851220</p>
                <p style="margin: 5px 0;"><strong>Email:</strong> info@adisaolashile.com</p>
                <p style="margin: 5px 0;"><strong>Website:</strong> adisaolashile.com</p>
              </div>
              
              <p>If you have an urgent inquiry, please don't hesitate to call us directly.</p>
              
              <div style="border-top: 2px solid #f0f0f0; padding-top: 20px; margin-top: 30px;">
                <p style="margin: 0; font-style: italic; color: #666;">"Great art picks up where nature ends." - Marc Chagall</p>
              </div>
              
              <p style="margin-top: 25px;">
                  Best regards,<br>
                  <strong>The Adisa Olashile Team</strong><br>
                  <span style="color: #666; font-size: 14px;">Contemporary African Artist</span>
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
THANK YOU FOR CONTACTING ADISA OLASHILE
=======================================

Dear ${name},

Thank you for contacting Adisa Olashile. We have received your message and will respond as soon as possible, typically within 24-48 hours.

YOUR MESSAGE SUMMARY:
Subject: ${subject}

${message}

OUR CONTACT INFORMATION:
Phone: +44 7887 851220
Email: info@adisaolashile.com
Website: adisaolashile.com

If you have an urgent inquiry, please call us directly.

"Great art picks up where nature ends." - Marc Chagall

Best regards,
The Adisa Olashile Team
Contemporary African Artist
      `
    };

    // Send both emails
    await transporter.sendMail(adminMailOptions);
    console.log('Admin email sent to:', adminEmail);
    
    await transporter.sendMail(userMailOptions);
    console.log('Confirmation email sent to:', email);

    res.status(200).json({ 
      success: true, 
      message: 'Message sent successfully! You should receive a confirmation email shortly.' 
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Contact form error:', error);
    
    // Provide more specific error messages
    let userErrorMessage = 'Failed to send message. Please try again later.';
    
    if (errorMessage.includes('Invalid login') || errorMessage.includes('BadCredentials')) {
      userErrorMessage = 'Email authentication failed. Please contact administrator.';
    } else if (errorMessage.includes('EAUTH')) {
      userErrorMessage = 'Email authentication failed. Please check your email configuration.';
    } else if (errorMessage.includes('ECONNREFUSED')) {
      userErrorMessage = 'Unable to connect to email server. Please try again later.';
    }
    
    res.status(500).json({ 
      success: false,
      error: userErrorMessage 
    });
  }
});

// ========== EXISTING STRIPE ENDPOINTS ==========
app.post('/create-checkout-session', async (req: Request<object, object, CreateCheckoutSessionRequest>, res: Response) => {
  try {
    const { items, customerEmail, successUrl, cancelUrl, currency, currencyMultiplier } = req.body;

    // Validate that the currency is supported by Stripe
    const supportedCurrencies = ['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'NGN'];
    const stripeCurrency = supportedCurrencies.includes(currency) ? currency : 'USD';

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((item) => ({
      price_data: {
        currency: stripeCurrency,
        product_data: {
          name: item.title,
        },
        unit_amount: Math.round(item.price * currencyMultiplier),
      },
      quantity: item.quantity,
    }));

    // Add shipping cost
    const shippingRates = {
      USD: 10,
      GBP: 7.9,
      NGN: 15000,
    };
    
    const shippingAmount = shippingRates[stripeCurrency as keyof typeof shippingRates] || 10;
    
    lineItems.push({
      price_data: {
        currency: stripeCurrency,
        product_data: { 
          name: 'Shipping',
          description: 'Standard shipping fee'
        },
        unit_amount: Math.round(shippingAmount * currencyMultiplier),
      },
      quantity: 1,
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      customer_email: customerEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      locale: 'auto',
      metadata: {
        customer_email: customerEmail,
        items_count: items.length.toString(),
        original_currency: currency
      }
    });

    res.json({ id: session.id, url: session.url });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Stripe session creation error:', error);
    res.status(500).json({ error: errorMessage });
  }
});

app.get('/verify-payment', async (req: Request, res: Response) => {
  try {
    const { session_id } = req.query;

    if (!session_id || typeof session_id !== 'string') {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['payment_intent']
    });

    res.json({
      id: session.id,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      customer_email: session.customer_email,
      metadata: session.metadata
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Payment verification error:', error);
    res.status(500).json({ error: errorMessage });
  }
});

app.post('/send-receipt', async (req: Request<object, object, SendReceiptRequest>, res: Response) => {
  try {
    const { customerEmail, orderId, items, total, customerName, shippingAddress } = req.body;

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      throw new Error('Email configuration is missing');
    }

    // Create transporter
    const transporter = getTransporter();

    // Email to customer
    const customerMailOptions = {
      from: `"Adisa Olashile Art" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: `Order Confirmation - ${orderId}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .order-details { background: #fff; padding: 30px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 10px 10px; }
            .item { border-bottom: 1px solid #eee; padding: 15px 0; display: flex; justify-content: space-between; }
            .total { font-weight: bold; font-size: 20px; margin-top: 25px; padding-top: 20px; border-top: 2px solid #4CAF50; text-align: right; }
            .thank-you { background: #e8f5e9; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">🎨 Thank You for Your Order!</h1>
              <p style="margin: 10px 0 0; opacity: 0.9;">Order ID: ${orderId}</p>
            </div>
            <div class="order-details">
              <div class="thank-you">
                <p style="margin: 0; font-size: 18px; color: #2e7d32;">Dear ${customerName}, thank you for supporting African art!</p>
              </div>
              
              <p><strong>Order Date:</strong> ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              
              <h3 style="color: #333; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px;">Order Summary:</h3>
              ${items.map((item) => `
                <div class="item">
                  <div>
                    <p style="margin: 0; font-weight: bold;">${item.title}</p>
                    <p style="margin: 5px 0 0; color: #666;">Quantity: ${item.quantity}</p>
                  </div>
                  <div style="text-align: right;">
                    <p style="margin: 0; font-weight: bold;">$${(item.price * item.quantity).toFixed(2)}</p>
                    <p style="margin: 5px 0 0; color: #666;">$${item.price.toFixed(2)} each</p>
                  </div>
                </div>
              `).join('')}
              
              <div class="total">
                <p style="margin: 0;">Total: <span style="color: #4CAF50; font-size: 22px;">$${total.toFixed(2)}</span></p>
              </div>
              
              <h3 style="color: #333; border-bottom: 2px solid #f0f0f0; padding-bottom: 10px; margin-top: 30px;">Shipping Information:</h3>
              <p><strong>Address:</strong><br>${shippingAddress.replace(/,/g, '<br>')}</p>
              
              <div style="background: #f8f9fa; padding: 20px; border-radius: 5px; margin-top: 25px;">
                <p style="margin: 0 0 10px; font-weight: bold; color: #d32f2f;">📦 Shipping Information:</p>
                <p style="margin: 0;">Your artwork will be carefully packaged and shipped within 2-3 business days. You will receive a tracking number once your order is dispatched.</p>
              </div>
              
              <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                <p style="margin: 0; color: #666;">If you have any questions about your order, please contact us at:</p>
                <p style="margin: 10px 0;"><strong>📧 info@adisaolashile.com | 📞 +44 7887 851220</strong></p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    // Email to admin
    const adminMailOptions = {
      from: `"Adisa Olashile Orders" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
      subject: `🛍️ New Order Received - ${orderId}`,
      html: `
        <h2>🛍️ New Order Received!</h2>
        <div style="background: #e3f2fd; padding: 20px; border-radius: 5px; margin: 15px 0;">
          <p><strong>Order ID:</strong> ${orderId}</p>
          <p><strong>Customer:</strong> ${customerName} (${customerEmail})</p>
          <p><strong>Total:</strong> $${total.toFixed(2)}</p>
          <p><strong>Order Date:</strong> ${new Date().toLocaleString()}</p>
        </div>
        
        <h3>Shipping Address:</h3>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 3px;">
          <p>${shippingAddress.replace(/,/g, '<br>')}</p>
        </div>
        
        <h3>Order Items (${items.length}):</h3>
        <ul>
          ${items.map((item) => `<li>${item.title} - $${item.price.toFixed(2)} x ${item.quantity} = $${(item.price * item.quantity).toFixed(2)}</li>`).join('')}
        </ul>
        
        <div style="margin-top: 25px; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107;">
          <p><strong>⚠️ Action Required:</strong> Process this order within 24 hours.</p>
        </div>
      `,
    };

    // Send both emails
    await transporter.sendMail(customerMailOptions);
    console.log('Order confirmation sent to customer:', customerEmail);
    
    await transporter.sendMail(adminMailOptions);
    console.log('Order notification sent to admin:', process.env.ADMIN_EMAIL);

    res.json({ 
      success: true, 
      message: 'Receipts sent successfully',
      orderId: orderId
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Email sending error:', error);
    res.status(500).json({ error: errorMessage });
  }
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    emailConfigured: !!(process.env.EMAIL_USER && process.env.EMAIL_PASS)
  });
});

// Test email endpoint (for debugging)
app.get('/test-email', async (req: Request, res: Response) => {
  try {
    const transporter = getTransporter();
    await transporter.verify();
    
    const testEmail = process.env.EMAIL_USER;
    const testMailOptions = {
      from: testEmail,
      to: testEmail,
      subject: 'Backend Email Test',
      text: 'This is a test email from your backend server.',
      html: '<h1>✅ Backend Email Test Successful!</h1><p>Your email configuration is working correctly.</p>'
    };

    const info = await transporter.sendMail(testMailOptions);
    
    res.json({ 
      success: true, 
      message: 'Test email sent successfully',
      messageId: info.messageId,
      smtpConfig: {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        user: process.env.EMAIL_USER?.substring(0, 3) + '...'
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Test email error:', error);
    res.status(500).json({ 
      success: false,
      error: errorMessage,
      smtpConfig: {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        user: process.env.EMAIL_USER
      }
    });
  }
});

// Only serve static files in production
if (process.env.NODE_ENV === 'production') {
  const __dirname = path.resolve();
  app.use(express.static(path.join(__dirname, 'dist')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🌐 Frontend URL: ${frontendUrl}`);
  console.log(`📧 Contact endpoint: POST ${frontendUrl}/api/contact`);
  console.log(`📧 Email configured for: ${process.env.EMAIL_USER}`);
  console.log(`📧 SMTP Server: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`);
  console.log(`✅ Test email endpoint: GET ${frontendUrl}/test-email`);
});