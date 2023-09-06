const SQLBuilder = require('../index');

let obj = {
    $from: 'sakila',
    $columns: {
        first_name: 1,
        length: 1,
    }
};

const sql = new SQLBuilder('SQLServer');
let output = sql['$select'](obj);

console.log(output.sql);
console.log(output.values);
