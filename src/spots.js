const california = require('./spots-california');
const eastcoast  = require('./spots-eastcoast');
const florida    = require('./spots-florida');
const hawaii     = require('./spots-hawaii');
module.exports   = [...california, ...eastcoast, ...florida, ...hawaii];
