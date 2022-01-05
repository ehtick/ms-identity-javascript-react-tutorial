/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const cors = require('cors');
const path = require('path');

const msalWrapper = require('msal-express-wrapper');
const passport = require('passport');
const BearerStrategy = require('passport-azure-ad').BearerStrategy;

const todolistRoutes = require('./routes/todolistRoutes');
const adminRoutes = require('./routes/adminRoutes');
const routeGuard = require('./utils/routeGuard');
const mongoHelper = require('./utils/mongoHelper');

const app = express();

app.set('views', path.join(__dirname, './views'));
app.set('view engine', 'ejs');

app.use('/css', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')));
app.use('/js', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js')));

app.use(express.static(path.join(__dirname, './public')));

app.use(methodOverride('_method'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/**
 * We need to enable CORS for client's domain in order to
 * expose www-authenticate header in response from the web API
 */
app.use(cors({
    exposedHeaders: "www-authenticate",
}));

/**
 * Using express-session middleware. Be sure to familiarize yourself with available options
 * and set them as desired. Visit: https://www.npmjs.com/package/express-session
 */
const sessionConfig = {
    secret: process.env.EXPRESS_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // set this to true on production
    }
}
// Look at cookies scure true that means look only in https
// in deploy make cookie to true

if (app.get('env') === 'production') {
    app.set('trust proxy', 1)
    sessionConfig.cookie.secure = true
}

app.use(session(sessionConfig));

 // trust first proxy e.g. App Service

// =========== Initialize Passport ==============

const bearerOptions = {
    identityMetadata: `https://${process.env.AUTHORITY}/${process.env.TENANT_ID}/v2.0/.well-known/openid-configuration`,
    issuer: `https://${process.env.AUTHORITY}/${process.env.TENANT_ID}/v2.0`,
    clientID: process.env.CLIENT_ID,
    audience: process.env.CLIENT_ID, // audience is this application
    validateIssuer: true,
    passReqToCallback: false,
    loggingLevel: "info",
    scope: [process.env.API_REQUIRED_PERMISSION] // scope you set during app registration
};

// console.log(bearerOptions, " bearerOptions")

const bearerStrategy = new BearerStrategy(bearerOptions, (token, done) => {
    // Send user info using the second argument
    done(null, {}, token);
});

app.use(passport.initialize());

passport.use(bearerStrategy);

// protected api endpoints
app.use('/api',
    passport.authenticate('oauth-bearer', { session: false }), // validate access tokens
    routeGuard, // check for auth context
    todolistRoutes
);

// =========== Initialize MSAL Node Wrapper==============

const appSettings = {
    appCredentials: {
        clientId: process.env.CLIENT_ID,
        tenantId: process.env.TENANT_ID,
        clientSecret: process.env.CLIENT_SECRET,
    },
    authRoutes: {
        redirect: process.env.REDIRECT_URI, // enter the path component of your redirect URI
        error: "/admin/error", // the wrapper will redirect to this route in case of any error
        unauthorized: "/admin/unauthorized" // the wrapper will redirect to this route in case of unauthorized access attempt
    },
    remoteResources: {
        // Microsoft Graph beta authenticationContextClassReference endpoint. For more information,
        // visit: https://docs.microsoft.com/en-us/graph/api/resources/authenticationcontextclassreference?view=graph-rest-beta
        msGraphAcrs: {
            endpoint: "https://graph.microsoft.com/beta/identity/conditionalAccess/policies",
            scopes: ["Policy.ReadWrite.ConditionalAccess", "Policy.Read.ConditionalAccess"]
        },
    }
}

// console.log(appSettings, " appSettings")

// instantiate the wrapper
const authProvider = new msalWrapper.AuthProvider(appSettings);

// initialize the wrapper
app.use(authProvider.initialize());

// pass down to the authProvider instance to use in router
app.use('/admin',
    adminRoutes(authProvider)
);

const port = process.env.PORT || 5000;


mongoHelper.mongoConnect(() => {
    app.listen(port, () => {
        console.log('Listening on port ' + port);
    });
});

module.exports = app;