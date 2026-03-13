

# Update Keith Vollberg to Uri / East Coast

## What
Update contact `36c38905-046a-4216-a4ca-73792f747e12` (Keith Vollberg):
- **assigned_to** → Uri Kaweblum (`9affa87c-4f01-45b8-a494-0a294beb1383`)
- **location_id** → East Coast (`acb2ee85-d4f7-4a4e-9b97-cd421554b8af`)

## How
Single SQL update via migration tool:

```sql
UPDATE contacts
SET assigned_to = '9affa87c-4f01-45b8-a494-0a294beb1383',
    location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af'
WHERE id = '36c38905-046a-4216-a4ca-73792f747e12';
```

No code changes needed.

