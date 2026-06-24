-- CareerConnect QA database creation for pgAdmin Query Tool.
--
-- Run this while connected to the default postgres database.
-- This script only creates careerconnect_qa when it does not already exist.
--
-- After it succeeds, manually switch pgAdmin's database connection/query
-- context to careerconnect_qa before applying schema migrations or QA seed data.
--
-- pgAdmin note:
-- PostgreSQL does not support CREATE DATABASE inside a DO block, so this script
-- uses a generated CREATE DATABASE statement and executes it through dblink.

CREATE EXTENSION IF NOT EXISTS dblink;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_database
    WHERE datname = 'careerconnect_qa'
  ) THEN
    PERFORM dblink_exec(
      'dbname=postgres',
      'CREATE DATABASE careerconnect_qa'
    );
  END IF;
END $$;
