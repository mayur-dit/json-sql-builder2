# orOffset Helper
Specifies the `OFFSET ${query} ROWS` clause for the `SELECT` Statement.

#### Supported by
- [Oracle](https://www.oracletutorial.com/oracle-basics/oracle-fetch/)

# Allowed Types and Usage

## as Number:

Usage of `orOffset` as **Number** with the following Syntax:

**Syntax:**

```javascript
$orOffset: < Number >
```

**SQL-Definition:**
```javascript
<value>
```

:bulb: **Example:**
```javascript
function() {
    let query = sql.build({
        $select: {
            $orOffset: 10,
            $from: 'Products',
            $orderBy: 'ProductName'
        }
    });

    return query;
}

// SQL output
SELECT
    *
FROM
    Products
ORDER BY
    ProductName ASC OFFSET 10 ROWS

// Values
{}
```

