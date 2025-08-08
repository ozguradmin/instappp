const serverless = require('serverless-http');
const { apiApp } = require('../../apiApp');

// Trim the Netlify function base path so Express routes can be mounted at root
module.exports.handler = serverless(apiApp, { basePath: '/.netlify/functions/api' });


