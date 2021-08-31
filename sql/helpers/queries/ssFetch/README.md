# ssFetch Helper
Specifies the `OFFSET ${query.$skip} ROWS FETCH FIRST ${query.$fetch} ROWS ONLY` clause for the `SELECT` Statement.

#### Supported by
- [SQLServer](https://docs.microsoft.com/en-us/sql/t-sql/queries/top-transact-sql)

# Allowed Types and Usage

## as Object:

Usage of `ssFetch` as **Object** with the following Syntax:

**Syntax:**

```javascript
$ssFetch: { ... }
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
            $ssFetch: { $skip: 30, $fetch: 10 },
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
    ProductName ASC OFFSET 30 ROWS
FETCH FIRST
    10 ROWS ONLY

// Values
{}
```

