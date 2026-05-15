DO $$
DECLARE
  r RECORD;
  inserted_count INT := 0;
  skipped_count INT := 0;
BEGIN
  FOR r IN
    WITH incoming(first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, lead_source) AS (
      VALUES
      ('Paul'::text, 'Batcho'::text, 'pbatcho@gmail.com'::text, '6462402161'::text, '4781 Baywood Point South'::text, 'Gulfport'::text, 'FL'::text, '33711'::text, 'Yelp'::text),
      ('Mike', 'Stipp', NULL, '9412189440', '1931 Beach Rd.', 'Englewood', 'FL', '34223', 'Referral'),
      ('Chuck', NULL, NULL, '9419930719', '2945 Seasons Boulevard', 'Sarasota', 'FL', '34240', 'Referral'),
      ('Jennifer', 'Barriffe', NULL, NULL, '10907 North 48th Street', 'Tampa', 'FL', '33617', 'Referral'),
      ('Rafael', 'Perez', 'Perezrnd88@gmail.com', '9415453107', '6115 47Th St E', 'Bradenton', 'FL', '34203', 'Door Knocking'),
      ('James', '& Evelyn White', NULL, '9419283943', '6107 47Th St E', 'Bradenton', 'FL', '34203', 'Door Knocking'),
      ('William', 'Brennan', 'william.j.brennan.3@gmail.com', '8455467125', '2845 Northwest 69Th Terrace', 'Margate', 'FL', '33063', NULL),
      ('Alexis', 'Patterson', 'alexis.patterson@rndc-usa.com', '3522627269', '2190 Sandlewood Drive', 'Venice', 'FL', '34293', 'Referral'),
      ('Irina', 'Gorovits', 'irina_g@comcast.net', '9414136428', '4345 Reflections Parkway', 'Sarasota', 'FL', '34233', 'Door Knocking'),
      ('Elizabeth', 'Jules', NULL, '3216669067', '4227 Shades Crest Lane', 'Sanford', 'FL', '32773', 'Referral'),
      ('Henry', 'Germann', 'hgermann@comcast.net', '9414846963', '309 Montelluna Dr', 'North Venice', 'FL', '34275', 'Door Knocking'),
      ('Josh', 'Rojas', NULL, '8135579226', '262 Pesarodr', 'North Venice', 'FL', '34275', 'Door Knocking'),
      ('Palm', 'Aire Gutter Job', NULL, NULL, 'Avista Drive', 'Sarasota', 'FL', '34243', 'Referral'),
      ('Barb', 'Drummond', NULL, '2394045667', '548 Spinnaker Drive', 'Marco Island', 'FL', '34145', 'Referral'),
      ('Sainy', 'Taha', 'sainytaha2@gmail.com', '9414686688', '1681 5Th Street', 'Englewood', 'FL', '34223', NULL),
      ('Andrew', 'Kinney', NULL, '8135508970', '2730 Garden Falls Drive', 'Brandon', 'FL', '33511', 'Referral'),
      ('Michael', 'Kelleher', 'mtkellah80@yahoo.com', '8135238007', '2753 Hampton Green Lane', 'Brandon', 'FL', '33511', 'Door Knocking'),
      ('Lucy', 'Desloge', NULL, '9415866166', '5185 Flicker Field Circle', 'Sarasota', 'FL', '34231', 'Door Knocking'),
      ('Abrahim', 'Aldani', NULL, '9412841707', '6111 47Th Street East', 'Bradenton', 'FL', '34203', 'Door Knocking'),
      ('Gene', 'Kragness', NULL, '6128059734', '2822 Southwest 49Th Terrace', 'Cape Coral', 'FL', '33914', 'Referral'),
      ('Duke', 'Herzel PAINT', 'spikeb4tiff@gmail.com', '9417730033', '6410 Bright Bay Court', 'Apollo Beach', 'FL', '33572', 'Door Knocking'),
      ('Mike', 'Cody', NULL, '9523676966', '4608 4Th Avenue Drive East', 'Bradenton', 'FL', '34208', NULL),
      ('Marsha', 'Winterhalter', NULL, '8138572566', '1707 71St Street Northwest', 'Bradenton', 'FL', '34209', NULL),
      ('Noya', 'Brigham', NULL, NULL, '6616 Gateway Avenue', 'Sarasota', 'FL', '34231', NULL),
      ('Rodney', 'Smith', NULL, '7868776575', '2732 Garden Falls Drive', 'Brandon', 'FL', '33511', 'Referral'),
      ('Russell', 'Kulp', 'culprit694@aim.com', NULL, '2575 Brassica Drive', 'North Port', 'FL', '34289', 'Door Knocking'),
      ('Pat', 'BonaVentura', 'Pstr4@aol.com', '6142350499', '8 Palm Harbor Drive', 'Holmes Beach', 'FL', '34217', 'Door Knocking'),
      ('Ina', 'Friedman', 'medpedspan24@protonmail.com', NULL, '2418 Temple Street', 'Sarasota', 'FL', '34239', NULL),
      ('Rajen', 'Desai', NULL, NULL, '3730 Turning Tides Terrace', 'Bradenton', 'FL', '34208', 'Yelp'),
      ('Kari', 'Hawkins', 'karibenae@gmail.com', '6123865394', '5541 Gulf Of Mexico Drive', 'Longboat Key', 'FL', '34228', 'Yelp'),
      ('Ina', 'Meredith', NULL, NULL, '2418 Temple Street #2', 'Sarasota', 'FL', '34239', 'Yelp'),
      ('Jim', 'Deering', NULL, '9414002878', '4476 Trails Drive', 'Sarasota', 'FL', '34232', 'Yelp'),
      ('Ron', 'Gagne', NULL, '6039781737', '9 Palm Harbor Drive', 'Holmes Beach', 'FL', '34217', 'Yelp'),
      ('Priscilla', 'Wolfe', NULL, '9412232505', '373 Ardenwood Drive', 'Englewood', 'FL', '34223', 'Yelp'),
      ('Kevin', 'Scafheimer', NULL, '8134867482', '2734 Garden Falls Drive', 'Brandon', 'FL', '33511', 'Referral'),
      ('Tinah', 'Gaymon', NULL, '3473023678', '2733 Garden Falls Drive', 'Brandon', 'FL', '33511', 'Referral'),
      ('Patrica', 'Stevenson', 'fergigirl@aol.com', '9413561309', '4349 Reflections Parkway', 'Sarasota', 'FL', '34233', 'Door Knocking'),
      ('Kevin', 'Moe', 'kmoe1885@gmail.com', NULL, '7621 Viola Loop', 'Bradenton', 'FL', '34202', 'Yelp'),
      ('Mark', 'Fox', 'fox.mkb@gmail.com', '7153497347', '4781 Baywood Point South #2', 'Gulfport', 'FL', '33711', 'Yelp')
    ),
    existing AS (
      SELECT lower(coalesce(email,'')) as e, regexp_replace(coalesce(phone,''), '\D','','g') as p, lower(coalesce(address_street,'')) as s, coalesce(address_zip,'') as z
      FROM contacts WHERE tenant_id='14de934e-7964-4afd-940a-620d2ace125d'
    )
    SELECT i.* FROM incoming i
    WHERE NOT EXISTS (SELECT 1 FROM existing e WHERE i.email IS NOT NULL AND lower(i.email)=e.e AND e.e<>'')
      AND NOT EXISTS (SELECT 1 FROM existing e WHERE i.phone IS NOT NULL AND i.phone=e.p AND e.p<>'')
      AND NOT EXISTS (SELECT 1 FROM existing e WHERE i.address_street IS NOT NULL AND lower(i.address_street)=e.s AND coalesce(i.address_zip,'')=e.z AND e.s<>'')
  LOOP
    BEGIN
      INSERT INTO contacts (tenant_id, location_id, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, lead_source, notes)
      VALUES ('14de934e-7964-4afd-940a-620d2ace125d', 'c490231c-2a0e-4afc-8412-672e1c890c16',
              r.first_name, r.last_name, r.email, r.phone, r.address_street, r.address_city, r.address_state, r.address_zip,
              r.lead_source, 'Imported from AccuLynx west coast jobs export');
      inserted_count := inserted_count + 1;
    EXCEPTION WHEN OTHERS THEN
      skipped_count := skipped_count + 1;
      RAISE NOTICE 'Skipped % % at %: %', r.first_name, r.last_name, r.address_street, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'Inserted: %, Skipped: %', inserted_count, skipped_count;
END $$;