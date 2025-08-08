const serverless = require('serverless-http');
const { apiApp } = require('../../apiApp');

module.exports.handler = serverless(apiApp, {
  request: (req) => {
    // Netlify Functions path rewrite: /.netlify/functions/api/* -> /
    if (req.url && req.url.startsWith('/.netlify/functions/api')) {
      req.url = req.url.replace('/.netlify/functions/api', '');
    }
    return req;
  },
});


