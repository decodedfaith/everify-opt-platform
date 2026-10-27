-- ============================================================================
-- E-Verify Platform - Initial Sample Seed Data
-- ============================================================================
-- Realistic sample records reflecting official USCIS E-Verify participating employers.
-- ============================================================================

INSERT INTO verified_employers (employer_name, address, city, state, zip_code, status)
VALUES
    ('Google LLC', '1600 Amphitheatre Pkwy', 'Mountain View', 'CA', '94043', 'Active'),
    ('Microsoft Corporation', 'One Microsoft Way', 'Redmond', 'WA', '98052', 'Active'),
    ('Amazon.com Services LLC', '410 Terry Ave N', 'Seattle', 'WA', '98109', 'Active'),
    ('Apple Inc.', 'One Apple Park Way', 'Cupertino', 'CA', '95014', 'Active'),
    ('Meta Platforms, Inc.', '1 Hacker Way', 'Menlo Park', 'CA', '94025', 'Active'),
    ('NVIDIA Corporation', '2788 San Tomas Expy', 'Santa Clara', 'CA', '95051', 'Active'),
    ('Tesla, Inc.', '1 Tesla Road', 'Austin', 'TX', '78725', 'Active'),
    ('Netflix, Inc.', '100 Winchester Circle', 'Los Gatos', 'CA', '95032', 'Active'),
    ('Salesforce, Inc.', '415 Mission Street, 3rd Floor', 'San Francisco', 'CA', '94105', 'Active'),
    ('Adobe Inc.', '345 Park Ave', 'San Jose', 'CA', '95110', 'Active'),
    ('Intel Corporation', '2200 Mission College Blvd', 'Santa Clara', 'CA', '95054', 'Active'),
    ('Cisco Systems, Inc.', '170 West Tasman Dr.', 'San Jose', 'CA', '95134', 'Active'),
    ('Oracle America, Inc.', '2300 Oracle Way', 'Austin', 'TX', '78741', 'Active'),
    ('Goldman Sachs & Co. LLC', '200 West Street', 'New York', 'NY', '10282', 'Active'),
    ('JPMorgan Chase Bank, N.A.', '383 Madison Avenue', 'New York', 'NY', '10179', 'Active'),
    ('Morgan Stanley & Co. LLC', '1585 Broadway', 'New York', 'NY', '10036', 'Active'),
    ('Bloomberg L.P.', '731 Lexington Ave', 'New York', 'NY', '10022', 'Active'),
    ('Stripe, Inc.', '354 Oyster Point Blvd', 'South San Francisco', 'CA', '94080', 'Active'),
    ('Uber Technologies, Inc.', '1515 3rd St', 'San Francisco', 'CA', '94158', 'Active'),
    ('Airbnb, Inc.', '888 Brannan St', 'San Francisco', 'CA', '94103', 'Active'),
    ('DoorDash, Inc.', '303 2nd St, South Tower, 8th Floor', 'San Francisco', 'CA', '94107', 'Active'),
    ('Palantir Technologies Inc.', '1200 17th St', 'Denver', 'CO', '80202', 'Active'),
    ('Databricks, Inc.', '160 Spear St, 13th Floor', 'San Francisco', 'CA', '94105', 'Active'),
    ('Snowflake Inc.', '106 East Babcock Street, Suite 3A', 'Bozeman', 'MT', '59715', 'Active'),
    ('Broadcom Inc.', '1320 Ridder Park Drive', 'San Jose', 'CA', '95131', 'Active'),
    ('Qualcomm Technologies, Inc.', '5775 Morehouse Drive', 'San Diego', 'CA', '92121', 'Active'),
    ('General Motors LLC', '300 Renaissance Center', 'Detroit', 'MI', '48265', 'Active'),
    ('Ford Motor Company', 'One American Road', 'Dearborn', 'MI', '48126', 'Active'),
    ('Boeing Company, The', '929 Long Bridge Drive', 'Arlington', 'VA', '22202', 'Active'),
    ('Lockheed Martin Corporation', '6801 Rockledge Dr', 'Bethesda', 'MD', '20817', 'Active'),
    ('Johnson & Johnson Services, Inc.', 'One Johnson & Johnson Plaza', 'New Brunswick', 'NJ', '08933', 'Active'),
    ('Pfizer Inc.', '66 Hudson Boulevard East', 'New York', 'NY', '10001', 'Active'),
    ('ModernaTX, Inc.', '200 Technology Square', 'Cambridge', 'MA', '02139', 'Active'),
    ('Waymo LLC', '1600 Amphitheatre Pkwy', 'Mountain View', 'CA', '94043', 'Active'),
    ('Cruise LLC', '333 Brannan St', 'San Francisco', 'CA', '94107', 'Active'),
    ('Space Exploration Technologies Corp.', '1 Rocket Road', 'Hawthorne', 'CA', '90250', 'Active'),
    ('ByteDance Inc.', '1199 Avenue of the Americas', 'New York', 'NY', '10036', 'Active'),
    ('Epic Games, Inc.', '620 Crossroads Blvd', 'Cary', 'NC', '27518', 'Active'),
    ('Roblox Corporation', '970 Park Place, Suite 100', 'San Mateo', 'CA', '94403', 'Active'),
    ('Defunct Tech Corp (Sample Inactive)', '123 Ghost St', 'Austin', 'TX', '78701', 'Terminated')
ON CONFLICT (employer_name, state, zip_code) 
DO UPDATE SET 
    address = EXCLUDED.address,
    city = EXCLUDED.city,
    status = EXCLUDED.status,
    updated_at = CURRENT_TIMESTAMP;
