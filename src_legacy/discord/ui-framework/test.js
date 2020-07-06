const { logger } = require('../../loaders/logger');
const Table  = require('./table.js').Table;

var columns = ["column1", "column2", "column3"];
var row1 = ["row11", "row12", "row13"];
var row2 = ["row21", "row22", "row23"];
var row3 = ["row31", "row32", "row33"];

var table = new Table(columns);
table.AddRow(row1);
table.AddRow(row2);
table.AddRow(row3);

var ret = table.Print();
logger.info(ret);
