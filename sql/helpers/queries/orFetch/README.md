# orFetch Helper
Specifies the `FETCH NEXT ${query} ROWS ONLY` clause for the `SELECT` Statement.

#### Supported by
- [Oracle](https://www.oracletutorial.com/oracle-basics/oracle-fetch/)

# Allowed Types and Usage

## as Number:

Usage of `orFetch` as **Number** with the following Syntax:

**Syntax:**

```javascript
$orFetch: < Number >
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
            $orFetch: 10,
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
    ProductName ASC FETCH NEXT 10 ROWS ONLY

// Values
{}
```

