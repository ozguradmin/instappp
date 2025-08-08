const serverless = require('serverless-http');
const { apiApp } = require('../../apiApp');

module.exports.handler = serverless(apiApp);


