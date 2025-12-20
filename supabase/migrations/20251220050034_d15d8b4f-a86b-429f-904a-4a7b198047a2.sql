-- Clear the broken phone number from communication_preferences
UPDATE communication_preferences 
SET sms_from_number = NULL 
WHERE sms_from_number = '+12399194485';