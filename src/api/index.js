const express = require('express');
const router = require('./routes');

const apiRouter = express.Router();

apiRouter.use('/', router);

module.exports = apiRouter;