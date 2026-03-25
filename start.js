// Wrapper to ensure the server runs from the correct directory
process.chdir(__dirname);
require('./server.js');
