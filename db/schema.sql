/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_agent_tools` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agent_id` int NOT NULL,
  `tool_id` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_agent_tools_agent_tool` (`agent_id`,`tool_id`),
  KEY `tool_id` (`tool_id`),
  CONSTRAINT `ai_agent_tools_ibfk_1` FOREIGN KEY (`agent_id`) REFERENCES `ai_agents` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ai_agent_tools_ibfk_2` FOREIGN KEY (`tool_id`) REFERENCES `ai_tools` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_agents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agent_type` enum('manager','noc_monitor','incident_responder','automation_operator','custom') NOT NULL,
  `name` varchar(128) NOT NULL,
  `description` text,
  `provider_id` int DEFAULT NULL,
  `model` varchar(255) DEFAULT NULL,
  `system_prompt` text NOT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `agent_key` varchar(128) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_agents_agent_key` (`agent_key`),
  KEY `provider_id` (`provider_id`),
  CONSTRAINT `ai_agents_ibfk_1` FOREIGN KEY (`provider_id`) REFERENCES `ai_providers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_conversations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `provider_id` int DEFAULT NULL,
  `model` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `provider_id` (`provider_id`),
  KEY `idx_ai_conversations_user_id` (`user_id`),
  CONSTRAINT `ai_conversations_ibfk_1` FOREIGN KEY (`provider_id`) REFERENCES `ai_providers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ai_conversations_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_feature_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agentic_noc_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `conversation_id` int NOT NULL,
  `role` enum('system','user','assistant') NOT NULL,
  `content` text NOT NULL,
  `context_summary` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `agent_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_messages_conversation_id` (`conversation_id`),
  KEY `idx_ai_messages_agent_id` (`agent_id`),
  CONSTRAINT `ai_messages_ibfk_1` FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ai_messages_agent_id_ai_agents` FOREIGN KEY (`agent_id`) REFERENCES `ai_agents` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_providers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `provider_type` enum('ollama','openai_compatible','openwebui','anthropic') NOT NULL,
  `base_url` varchar(512) NOT NULL,
  `default_model` varchar(255) NOT NULL,
  `api_key` text,
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `request_timeout_seconds` int NOT NULL DEFAULT '60',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_providers_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_tools` (
  `id` int NOT NULL AUTO_INCREMENT,
  `job_template_id` int NOT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `tool_name` varchar(128) NOT NULL,
  `description` text,
  `when_to_use` text,
  `input_hint` text,
  `example_payload` json DEFAULT NULL,
  `safety_notes` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ai_tools_job_template_id` (`job_template_id`),
  UNIQUE KEY `uq_ai_tools_tool_name` (`tool_name`),
  CONSTRAINT `ai_tools_ibfk_1` FOREIGN KEY (`job_template_id`) REFERENCES `job_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_user_preferences` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `system_prompt` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  UNIQUE KEY `ix_ai_user_preferences_user_id` (`user_id`),
  CONSTRAINT `ai_user_preferences_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `app_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `alembic_version` (
  `version_num` varchar(32) NOT NULL,
  PRIMARY KEY (`version_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ansible_defaults` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `value` text,
  `is_secret` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ansible_defaults_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ansible_runner_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `kerberos_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `kerberos_krb5_conf` text,
  `kerberos_ccache_name` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ansible_playbooks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `repo_id` int NOT NULL,
  `path` varchar(512) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ansible_playbooks_repo_path` (`repo_id`,`path`),
  CONSTRAINT `fk_ansible_playbooks_repo` FOREIGN KEY (`repo_id`) REFERENCES `git_repos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `app_backup_config` (
  `id` int unsigned NOT NULL,
  `schedule_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `cron_expression` varchar(128) NOT NULL DEFAULT '0 2 * * *',
  `timezone` varchar(64) NOT NULL DEFAULT 'UTC',
  `retention_count` int unsigned NOT NULL DEFAULT '10',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `app_backup_history` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) NOT NULL,
  `size_bytes` bigint unsigned NOT NULL DEFAULT '0',
  `status` varchar(32) NOT NULL,
  `trigger_source` varchar(32) NOT NULL,
  `error_message` text,
  `started_at` datetime NOT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_by` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `filename` (`filename`),
  KEY `idx_app_backup_history_started` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `app_fields` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `app_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL,
  `default_value` text,
  `is_secret` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_app_fields_app_name` (`app_id`,`name`),
  KEY `idx_app_fields_app` (`app_id`),
  CONSTRAINT `fk_app_fields_app` FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `app_users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `hashed_password` varchar(255) NOT NULL,
  `role` enum('admin','readonly') NOT NULL DEFAULT 'readonly',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`),
  KEY `ix_app_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_api_keys` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `key_prefix` varchar(32) NOT NULL,
  `key_hash` varchar(64) NOT NULL,
  `permissions` json NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `last_used_at` datetime DEFAULT NULL,
  `created_by_user_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inventory_api_keys_key_hash` (`key_hash`),
  UNIQUE KEY `uq_inventory_api_keys_name` (`name`),
  KEY `ix_inventory_api_keys_key_hash` (`key_hash`),
  KEY `ix_inventory_api_keys_name` (`name`),
  KEY `created_by_user_id` (`created_by_user_id`),
  CONSTRAINT `inventory_api_keys_ibfk_1` FOREIGN KEY (`created_by_user_id`) REFERENCES `app_users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `apps` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `datastores` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `domains` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `fqdn` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `fqdn` (`fqdn`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `environments` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `git_credentials` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `auth_type` enum('none','https','ssh') NOT NULL DEFAULT 'none',
  `https_username` varchar(255) DEFAULT NULL,
  `https_password` text,
  `ssh_private_key` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_git_credentials_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `git_repos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `url` varchar(512) NOT NULL,
  `branch` varchar(128) NOT NULL DEFAULT 'main',
  `repo_type` enum('ansible','app') NOT NULL DEFAULT 'ansible',
  `auth_type` enum('none','https','ssh') NOT NULL DEFAULT 'none',
  `https_username` varchar(255) DEFAULT NULL,
  `https_password` text,
  `ssh_private_key` text,
  `last_synced_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `credential_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_git_repos_name` (`name`),
  KEY `fk_git_repos_credential` (`credential_id`),
  CONSTRAINT `fk_git_repos_credential` FOREIGN KEY (`credential_id`) REFERENCES `git_credentials` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `global_default_roles` (
  `role_id` int unsigned NOT NULL,
  `priority` smallint NOT NULL DEFAULT '100',
  PRIMARY KEY (`role_id`),
  CONSTRAINT `fk_global_default_roles_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_ansible_vars` (
  `host_id` int unsigned NOT NULL,
  `var_id` int unsigned NOT NULL,
  `value` text,
  PRIMARY KEY (`host_id`,`var_id`),
  KEY `idx_host_ansible_vars_var` (`var_id`),
  CONSTRAINT `fk_host_ansible_vars_host` FOREIGN KEY (`host_id`) REFERENCES `hosts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_host_ansible_vars_var` FOREIGN KEY (`var_id`) REFERENCES `ansible_defaults` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_app_fields` (
  `host_id` int unsigned NOT NULL,
  `app_id` int unsigned NOT NULL,
  `field_id` int unsigned NOT NULL,
  `value` text,
  PRIMARY KEY (`host_id`,`app_id`,`field_id`),
  KEY `idx_host_app_fields_field` (`field_id`),
  CONSTRAINT `fk_host_app_fields_field` FOREIGN KEY (`field_id`) REFERENCES `app_fields` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_host_app_fields_host_app` FOREIGN KEY (`host_id`, `app_id`) REFERENCES `host_apps` (`host_id`, `app_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_apps` (
  `host_id` int unsigned NOT NULL,
  `app_id` int unsigned NOT NULL,
  PRIMARY KEY (`host_id`,`app_id`),
  KEY `idx_host_apps_app` (`app_id`),
  CONSTRAINT `fk_host_apps_app` FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_host_apps_host` FOREIGN KEY (`host_id`) REFERENCES `hosts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_host_type_fields` (
  `host_id` int unsigned NOT NULL,
  `field_id` int unsigned NOT NULL,
  `value` text,
  PRIMARY KEY (`host_id`,`field_id`),
  KEY `idx_host_host_type_fields_field` (`field_id`),
  CONSTRAINT `fk_host_host_type_fields_field` FOREIGN KEY (`field_id`) REFERENCES `host_type_fields` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_host_host_type_fields_host` FOREIGN KEY (`host_id`) REFERENCES `hosts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_resources` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `host_id` int unsigned NOT NULL,
  `cpu_sockets` tinyint unsigned NOT NULL DEFAULT '1',
  `cpu_cores` tinyint unsigned NOT NULL,
  `ram_mb` int unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `host_id` (`host_id`),
  CONSTRAINT `fk_host_resources_host` FOREIGN KEY (`host_id`) REFERENCES `hosts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_role_fields` (
  `host_id` int unsigned NOT NULL,
  `field_id` int unsigned NOT NULL,
  `value` text,
  PRIMARY KEY (`host_id`,`field_id`),
  KEY `idx_host_role_fields_field` (`field_id`),
  CONSTRAINT `fk_host_role_fields_field` FOREIGN KEY (`field_id`) REFERENCES `role_fields` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_host_role_fields_host` FOREIGN KEY (`host_id`) REFERENCES `hosts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_roles` (
  `host_id` int unsigned NOT NULL,
  `role_id` int unsigned NOT NULL,
  `priority` smallint NOT NULL DEFAULT '100',
  PRIMARY KEY (`host_id`,`role_id`),
  KEY `fk_host_roles_role` (`role_id`),
  CONSTRAINT `fk_host_roles_host` FOREIGN KEY (`host_id`) REFERENCES `hosts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_host_roles_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_status_fields` (
  `host_id` int unsigned NOT NULL,
  `field_id` int unsigned NOT NULL,
  `value` text,
  PRIMARY KEY (`host_id`,`field_id`),
  KEY `idx_host_status_fields_field` (`field_id`),
  CONSTRAINT `fk_host_status_fields_field` FOREIGN KEY (`field_id`) REFERENCES `status_fields` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_host_status_fields_host` FOREIGN KEY (`host_id`) REFERENCES `hosts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_statuses` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_storage` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `host_id` int unsigned NOT NULL,
  `purpose` varchar(32) NOT NULL,
  `datastore_id` int unsigned NOT NULL,
  `size_gb` int unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_host_storage_purpose` (`host_id`,`purpose`),
  KEY `idx_host_storage_datastore` (`datastore_id`),
  CONSTRAINT `fk_host_storage_datastore` FOREIGN KEY (`datastore_id`) REFERENCES `datastores` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_host_storage_host` FOREIGN KEY (`host_id`) REFERENCES `hosts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_type_fields` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `host_type_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL,
  `default_value` text,
  `is_secret` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_host_type_fields_type_name` (`host_type_id`,`name`),
  KEY `idx_host_type_fields_host_type` (`host_type_id`),
  CONSTRAINT `fk_host_type_fields_host_type` FOREIGN KEY (`host_type_id`) REFERENCES `host_types` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_type_roles` (
  `host_type_id` int unsigned NOT NULL,
  `role_id` int unsigned NOT NULL,
  `priority` smallint NOT NULL DEFAULT '100',
  PRIMARY KEY (`host_type_id`,`role_id`),
  KEY `fk_host_type_roles_role` (`role_id`),
  CONSTRAINT `fk_host_type_roles_host_type` FOREIGN KEY (`host_type_id`) REFERENCES `host_types` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_host_type_roles_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `host_types` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hosts` (
  `id` int unsigned NOT NULL,
  `environment_id` int unsigned NOT NULL,
  `host_type_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL,
  `vlan_id` int unsigned NOT NULL,
  `ipv4` varchar(15) NOT NULL,
  `mac` varchar(17) DEFAULT NULL,
  `k3s_cluster_id` int unsigned DEFAULT NULL,
  `proxmox_host_id` int unsigned DEFAULT NULL,
  `proxmox_node` varchar(64) DEFAULT NULL,
  `last_synced_at` datetime DEFAULT NULL,
  `domain_internal_id` int unsigned DEFAULT NULL,
  `domain_external_id` int unsigned DEFAULT NULL,
  `notes` text,
  `status_id` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_hosts_domain_internal` (`domain_internal_id`),
  KEY `fk_hosts_domain_external` (`domain_external_id`),
  KEY `fk_hosts_status` (`status_id`),
  KEY `idx_hosts_environment` (`environment_id`),
  KEY `idx_hosts_host_type` (`host_type_id`),
  KEY `idx_hosts_vlan` (`vlan_id`),
  KEY `idx_hosts_k3s_cluster` (`k3s_cluster_id`),
  KEY `idx_hosts_proxmox_host` (`proxmox_host_id`),
  CONSTRAINT `fk_hosts_domain_external` FOREIGN KEY (`domain_external_id`) REFERENCES `domains` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_hosts_domain_internal` FOREIGN KEY (`domain_internal_id`) REFERENCES `domains` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_hosts_environment` FOREIGN KEY (`environment_id`) REFERENCES `environments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_hosts_host_type` FOREIGN KEY (`host_type_id`) REFERENCES `host_types` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_hosts_k3s_cluster` FOREIGN KEY (`k3s_cluster_id`) REFERENCES `k3s_clusters` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_hosts_proxmox_host` FOREIGN KEY (`proxmox_host_id`) REFERENCES `hosts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_hosts_status` FOREIGN KEY (`status_id`) REFERENCES `host_statuses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_hosts_vlan` FOREIGN KEY (`vlan_id`) REFERENCES `vlans` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_template_schedules` (
  `id` int NOT NULL AUTO_INCREMENT,
  `job_template_id` int NOT NULL,
  `cron_expr` varchar(100) NOT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `next_run_at` datetime DEFAULT NULL,
  `last_run_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_job_template_schedules_template` (`job_template_id`),
  CONSTRAINT `fk_job_template_schedules_template` FOREIGN KEY (`job_template_id`) REFERENCES `job_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `description` text,
  `playbook_id` int DEFAULT NULL,
  `inventory_filter_type` enum('all','environment','role','vlan','pattern','hosts') NOT NULL DEFAULT 'all',
  `inventory_filter_value` json DEFAULT NULL,
  `inventory_filters` json DEFAULT NULL,
  `extra_vars` json DEFAULT NULL,
  `vault_credential_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `runbook_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `runbook_category` varchar(64) DEFAULT NULL,
  `recommended_when` text,
  `risk_level` varchar(32) DEFAULT NULL,
  `alert_match_type` varchar(64) DEFAULT NULL,
  `alert_match_value` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_job_templates_name` (`name`),
  KEY `fk_job_templates_playbook` (`playbook_id`),
  KEY `fk_job_templates_vault_credential` (`vault_credential_id`),
  KEY `idx_job_templates_runbook_enabled` (`runbook_enabled`),
  CONSTRAINT `fk_job_templates_playbook` FOREIGN KEY (`playbook_id`) REFERENCES `ansible_playbooks` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_job_templates_vault_credential` FOREIGN KEY (`vault_credential_id`) REFERENCES `vault_credentials` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_template_preview_cache` (
  `id` int NOT NULL AUTO_INCREMENT,
  `job_template_id` int NOT NULL,
  `playbook_id` int DEFAULT NULL,
  `repo_commit_sha` varchar(64) DEFAULT NULL,
  `template_fingerprint` varchar(128) NOT NULL,
  `inventory_fingerprint` varchar(128) NOT NULL,
  `preview_json` json NOT NULL,
  `generated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_job_template_preview_cache_job_template` (`job_template_id`),
  KEY `playbook_id` (`playbook_id`),
  CONSTRAINT `job_template_preview_cache_ibfk_1` FOREIGN KEY (`job_template_id`) REFERENCES `job_templates` (`id`) ON DELETE CASCADE,
  CONSTRAINT `job_template_preview_cache_ibfk_2` FOREIGN KEY (`playbook_id`) REFERENCES `ansible_playbooks` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `k3s_clusters` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `environment_id` int unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`),
  KEY `idx_k3s_clusters_environment` (`environment_id`),
  CONSTRAINT `fk_k3s_clusters_environment` FOREIGN KEY (`environment_id`) REFERENCES `environments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `k3s_cluster_apps` (
  `cluster_id` int unsigned NOT NULL,
  `app_id` int unsigned NOT NULL,
  PRIMARY KEY (`cluster_id`,`app_id`),
  KEY `idx_k3s_cluster_apps_app` (`app_id`),
  CONSTRAINT `fk_k3s_cluster_apps_app` FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_k3s_cluster_apps_cluster` FOREIGN KEY (`cluster_id`) REFERENCES `k3s_clusters` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `monitoring_secret_mappings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `job_template_id` int DEFAULT NULL,
  `item_reference` varchar(255) NOT NULL,
  `item_field` varchar(255) NOT NULL DEFAULT 'password',
  `ansible_var_name` varchar(255) NOT NULL,
  `injection_mode` enum('extra_vars','vault_password_file') NOT NULL DEFAULT 'extra_vars',
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_monitoring_secret_mappings_name` (`name`),
  KEY `job_template_id` (`job_template_id`),
  CONSTRAINT `monitoring_secret_mappings_ibfk_1` FOREIGN KEY (`job_template_id`) REFERENCES `job_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `monitoring_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `prometheus_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `prometheus_url` varchar(512) DEFAULT NULL,
  `prometheus_timeout_seconds` int NOT NULL DEFAULT '10',
  `prometheus_verify_tls` tinyint(1) NOT NULL DEFAULT '1',
  `prometheus_auth_type` enum('none','basic','bearer') NOT NULL DEFAULT 'none',
  `prometheus_username` varchar(255) DEFAULT NULL,
  `prometheus_password` text,
  `prometheus_bearer_token` text,
  `loki_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `loki_url` varchar(512) DEFAULT NULL,
  `loki_timeout_seconds` int NOT NULL DEFAULT '10',
  `loki_verify_tls` tinyint(1) NOT NULL DEFAULT '1',
  `loki_auth_type` enum('none','basic','bearer') NOT NULL DEFAULT 'none',
  `loki_username` varchar(255) DEFAULT NULL,
  `loki_password` text,
  `loki_bearer_token` text,
  `bitwarden_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `bitwarden_server_url` varchar(512) DEFAULT NULL,
  `bitwarden_access_token` text,
  `bitwarden_verify_tls` tinyint(1) NOT NULL DEFAULT '1',
  `bitwarden_organization_id` varchar(128) DEFAULT NULL,
  `bitwarden_collection_id` varchar(128) DEFAULT NULL,
  `bitwarden_auth_method` varchar(32) NOT NULL DEFAULT 'token',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `playbook_runs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `playbook_id` int NOT NULL,
  `run_by_id` int NOT NULL,
  `host_source` enum('inventory','repo') NOT NULL DEFAULT 'inventory',
  `target_host_ids` json DEFAULT NULL,
  `extra_vars` json DEFAULT NULL,
  `status` enum('pending','running','success','failed','cancelled') NOT NULL DEFAULT 'pending',
  `output` longtext,
  `exit_code` int DEFAULT NULL,
  `sidecar_job_id` varchar(64) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `job_template_id` int DEFAULT NULL,
  `inventory_filter_type` enum('all','environment','role','vlan','pattern','hosts') DEFAULT NULL,
  `inventory_filter_value` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_playbook_runs_playbook` (`playbook_id`),
  KEY `fk_playbook_runs_user` (`run_by_id`),
  KEY `idx_playbook_runs_status` (`status`),
  KEY `idx_playbook_runs_created_at` (`created_at`),
  KEY `idx_playbook_runs_job_template_id` (`job_template_id`),
  CONSTRAINT `fk_playbook_runs_job_template` FOREIGN KEY (`job_template_id`) REFERENCES `job_templates` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_playbook_runs_playbook` FOREIGN KEY (`playbook_id`) REFERENCES `ansible_playbooks` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_playbook_runs_user` FOREIGN KEY (`run_by_id`) REFERENCES `app_users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `proxmox_credentials` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `base_url` varchar(255) NOT NULL,
  `auth_type` varchar(16) NOT NULL,
  `token_id` varchar(128) DEFAULT NULL,
  `encrypted_token_secret` text,
  `username` varchar(128) DEFAULT NULL,
  `encrypted_password` text,
  `verify_tls` tinyint(1) NOT NULL DEFAULT '1',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `last_sync_at` datetime DEFAULT NULL,
  `last_sync_error` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `proxmox_node_storage` (
  `id` int NOT NULL AUTO_INCREMENT,
  `node` varchar(64) NOT NULL,
  `storage` varchar(64) NOT NULL,
  `datastore_id` int unsigned DEFAULT NULL,
  `storage_type` varchar(32) DEFAULT NULL,
  `total_gb` int DEFAULT NULL,
  `used_gb` int DEFAULT NULL,
  `avail_gb` int DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `last_synced_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_proxmox_node_storage` (`node`,`storage`),
  KEY `fk_pns_datastore` (`datastore_id`),
  CONSTRAINT `fk_pns_datastore` FOREIGN KEY (`datastore_id`) REFERENCES `datastores` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `proxmox_pending_hosts` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `sync_run_id` int unsigned DEFAULT NULL,
  `vmid` int DEFAULT NULL,
  `name` varchar(64) NOT NULL,
  `vm_type` varchar(16) NOT NULL DEFAULT 'qemu',
  `node` varchar(64) DEFAULT NULL,
  `cpu_cores` smallint NOT NULL DEFAULT '1',
  `ram_mb` int NOT NULL DEFAULT '512',
  `disks_json` text,
  `nets_json` text,
  `environment_id` int unsigned DEFAULT NULL,
  `host_type_id` int unsigned DEFAULT NULL,
  `vlan_id` int unsigned DEFAULT NULL,
  `role_id` int unsigned DEFAULT NULL,
  `credential_id` int unsigned DEFAULT NULL,
  `host_id_override` int DEFAULT NULL,
  `ipv4` varchar(15) DEFAULT NULL,
  `mac` varchar(17) DEFAULT NULL,
  `notes` text,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `created_at` datetime NOT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `vmid` (`vmid`),
  KEY `fk_pph_environment` (`environment_id`),
  KEY `fk_pph_host_type` (`host_type_id`),
  KEY `fk_pph_vlan` (`vlan_id`),
  KEY `fk_pph_role` (`role_id`),
  KEY `fk_pph_credential` (`credential_id`),
  KEY `idx_pph_sync_run` (`sync_run_id`),
  CONSTRAINT `fk_pph_credential` FOREIGN KEY (`credential_id`) REFERENCES `proxmox_credentials` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pph_environment` FOREIGN KEY (`environment_id`) REFERENCES `environments` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pph_host_type` FOREIGN KEY (`host_type_id`) REFERENCES `host_types` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pph_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pph_sync_run` FOREIGN KEY (`sync_run_id`) REFERENCES `proxmox_sync_runs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_pph_vlan` FOREIGN KEY (`vlan_id`) REFERENCES `vlans` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `proxmox_sync_runs` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `status` varchar(32) NOT NULL,
  `trigger_source` varchar(32) NOT NULL,
  `message` text,
  `stats_json` text,
  `started_at` datetime NOT NULL,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_proxmox_sync_runs_started_at` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `proxmox_sync_schedules` (
  `id` int unsigned NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `cron_expression` varchar(128) NOT NULL DEFAULT '0 * * * *',
  `timezone` varchar(64) NOT NULL DEFAULT 'UTC',
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_fields` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `role_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL,
  `default_value` text,
  `is_secret` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_fields_role_name` (`role_id`,`name`),
  KEY `idx_role_fields_role` (`role_id`),
  CONSTRAINT `fk_role_fields_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `status_fields` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `status_id` int unsigned NOT NULL,
  `name` varchar(64) NOT NULL,
  `default_value` text,
  `is_secret` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_status_fields_status_name` (`status_id`,`name`),
  KEY `idx_status_fields_status` (`status_id`),
  CONSTRAINT `fk_status_fields_status` FOREIGN KEY (`status_id`) REFERENCES `host_statuses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `unifi_host_observations` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `host_id` int unsigned NOT NULL,
  `mac` varchar(17) DEFAULT NULL,
  `observed_ipv4` varchar(15) DEFAULT NULL,
  `network_name` varchar(128) DEFAULT NULL,
  `network_id` varchar(128) DEFAULT NULL,
  `vlan_tag` int DEFAULT NULL,
  `unifi_client_name` varchar(128) DEFAULT NULL,
  `last_seen_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `host_id` (`host_id`),
  CONSTRAINT `unifi_host_observations_ibfk_1` FOREIGN KEY (`host_id`) REFERENCES `hosts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `unifi_port_forward_observations` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `host_id` int unsigned NOT NULL,
  `rule_name` varchar(128) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `protocol` varchar(16) DEFAULT NULL,
  `external_port` varchar(64) DEFAULT NULL,
  `internal_port` varchar(64) DEFAULT NULL,
  `source_restriction` varchar(255) DEFAULT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `observed_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `host_id` (`host_id`),
  CONSTRAINT `unifi_port_forward_observations_ibfk_1` FOREIGN KEY (`host_id`) REFERENCES `hosts` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `unifi_settings` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `base_url` varchar(255) DEFAULT NULL,
  `username` varchar(128) DEFAULT NULL,
  `encrypted_password` text,
  `site` varchar(128) DEFAULT NULL,
  `verify_tls` tinyint(1) NOT NULL DEFAULT '1',
  `last_sync_at` datetime DEFAULT NULL,
  `last_sync_error` text,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `unifi_sync_runs` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `status` varchar(32) NOT NULL,
  `trigger_source` varchar(32) NOT NULL,
  `message` text,
  `stats_json` text,
  `started_at` datetime NOT NULL,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
SET @saved_cs_client     = @@character_set_client;
/*!50503 SET character_set_client = utf8mb4 */;
/*!50001 CREATE VIEW `v_inventory` AS SELECT
 1 AS `id`,
 1 AS `env`,
 1 AS `type`,
 1 AS `name`,
 1 AS `vlan_id`,
 1 AS `ipv4`,
 1 AS `mac`,
 1 AS `role`,
 1 AS `k3s_cluster`,
 1 AS `apps`,
 1 AS `proxmox_host`,
 1 AS `proxmox_node`,
 1 AS `vm_cpu_socket`,
 1 AS `vm_cpu_core`,
 1 AS `vm_ram`,
 1 AS `vm_storage_os_datastore`,
 1 AS `vm_storage_os_size`,
 1 AS `vm_storage_hdd01_datastore`,
 1 AS `vm_storage_hdd01_size`,
 1 AS `domain_internal`,
 1 AS `external_domain`,
 1 AS `notes`,
 1 AS `last_synced_at`,
 1 AS `status`*/;
SET character_set_client = @saved_cs_client;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vault_credentials` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(128) NOT NULL,
  `vault_password` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vault_credentials_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vlans` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `vlan_id` int unsigned NOT NULL,
  `subnet` varchar(18) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `vlan_id` (`vlan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50001 DROP VIEW IF EXISTS `v_inventory`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = latin1 */;
/*!50001 SET character_set_results     = latin1 */;
/*!50001 SET collation_connection      = latin1_swedish_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50001 VIEW `v_inventory` AS select `h`.`id` AS `id`,`e`.`name` AS `env`,`ht`.`name` AS `type`,`h`.`name` AS `name`,`v`.`vlan_id` AS `vlan_id`,`h`.`ipv4` AS `ipv4`,`h`.`mac` AS `mac`,(select group_concat(`r2`.`name` order by `hr2`.`priority` ASC separator ', ') from (`host_roles` `hr2` join `roles` `r2` on((`r2`.`id` = `hr2`.`role_id`))) where (`hr2`.`host_id` = `h`.`id`)) AS `role`,`kc`.`name` AS `k3s_cluster`,group_concat(distinct `a`.`name` order by `a`.`name` ASC separator ', ') AS `apps`,`ph`.`name` AS `proxmox_host`,`h`.`proxmox_node` AS `proxmox_node`,`hr`.`cpu_sockets` AS `vm_cpu_socket`,`hr`.`cpu_cores` AS `vm_cpu_core`,concat((`hr`.`ram_mb` DIV 1024),'GB') AS `vm_ram`,`ds_os`.`name` AS `vm_storage_os_datastore`,concat(`hs_os`.`size_gb`,'GB') AS `vm_storage_os_size`,`ds_h1`.`name` AS `vm_storage_hdd01_datastore`,concat(`hs_h1`.`size_gb`,'GB') AS `vm_storage_hdd01_size`,`di`.`fqdn` AS `domain_internal`,`de`.`fqdn` AS `external_domain`,`h`.`notes` AS `notes`,`h`.`last_synced_at` AS `last_synced_at`,`hst`.`name` AS `status` from (((((((((((((((`hosts` `h` left join `environments` `e` on((`e`.`id` = `h`.`environment_id`))) left join `host_types` `ht` on((`ht`.`id` = `h`.`host_type_id`))) left join `vlans` `v` on((`v`.`id` = `h`.`vlan_id`))) left join `host_statuses` `hst` on((`hst`.`id` = `h`.`status_id`))) left join `k3s_clusters` `kc` on((`kc`.`id` = `h`.`k3s_cluster_id`))) left join `hosts` `ph` on((`ph`.`id` = `h`.`proxmox_host_id`))) left join `domains` `di` on((`di`.`id` = `h`.`domain_internal_id`))) left join `domains` `de` on((`de`.`id` = `h`.`domain_external_id`))) left join `host_resources` `hr` on((`hr`.`host_id` = `h`.`id`))) left join `host_storage` `hs_os` on(((`hs_os`.`host_id` = `h`.`id`) and (`hs_os`.`purpose` = 'os')))) left join `datastores` `ds_os` on((`ds_os`.`id` = `hs_os`.`datastore_id`))) left join `host_storage` `hs_h1` on(((`hs_h1`.`host_id` = `h`.`id`) and (`hs_h1`.`purpose` = 'hdd01')))) left join `datastores` `ds_h1` on((`ds_h1`.`id` = `hs_h1`.`datastore_id`))) left join `host_apps` `ha` on((`ha`.`host_id` = `h`.`id`))) left join `apps` `a` on((`a`.`id` = `ha`.`app_id`))) group by `h`.`id`,`e`.`name`,`ht`.`name`,`h`.`name`,`v`.`vlan_id`,`h`.`ipv4`,`h`.`mac`,`kc`.`name`,`ph`.`name`,`h`.`proxmox_node`,`hr`.`cpu_sockets`,`hr`.`cpu_cores`,`hr`.`ram_mb`,`ds_os`.`name`,`hs_os`.`size_gb`,`ds_h1`.`name`,`hs_h1`.`size_gb`,`di`.`fqdn`,`de`.`fqdn`,`h`.`notes`,`h`.`last_synced_at`,`hst`.`name` */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;


INSERT INTO alembic_version (version_num) VALUES ('001');
