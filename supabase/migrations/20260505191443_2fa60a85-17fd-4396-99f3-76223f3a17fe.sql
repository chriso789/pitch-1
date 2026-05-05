-- Fix Ken Maxwell's last name from "Contact" to "Maxwell"
UPDATE contacts 
SET last_name = 'Maxwell' 
WHERE id = '57224b96-92a2-4854-a2fb-c4f01ac02b0a' 
  AND last_name = 'Contact' 
  AND first_name = 'Ken';
