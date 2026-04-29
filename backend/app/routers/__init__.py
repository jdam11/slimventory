from .admin import router as admin
from .ai import router as ai
from .ansible_defaults import router as ansible_defaults
from .ansible_playbooks import router as ansible_playbooks
from .app_fields import router as app_fields
from .apps import router as apps
from .auth import router as auth
from .backup import router as backup
from .datastores import router as datastores
from .domains import router as domains
from .environments import router as environments
from .git_credentials import router as git_credentials
from .git_repos import router as git_repos
from .global_default_roles import router as global_default_roles
from .host_ansible_vars import router as host_ansible_vars
from .host_app_fields import router as host_app_fields
from .host_apps import router as host_apps
from .host_host_type_fields import router as host_host_type_fields
from .host_resources import router as host_resources
from .host_role_fields import router as host_role_fields
from .host_status_fields import router as host_status_fields
from .host_statuses import router as host_statuses
from .host_storage import router as host_storage
from .host_type_fields import router as host_type_fields
from .host_type_roles import router as host_type_roles
from .host_types import router as host_types
from .hosts import router as hosts
from .inventory import router as inventory
from .job_templates import router as job_templates
from .k3s_cluster_apps import router as k3s_cluster_apps
from .k3s_clusters import router as k3s_clusters
from .monitoring import router as monitoring
from .playbook_runs import router as playbook_runs
from .proxmox import router as proxmox
from .role_fields import router as role_fields
from .role_matrix import router as role_matrix
from .roles import router as roles
from .status_fields import router as status_fields
from .unifi import router as unifi
from .vault_credentials import router as vault_credentials
from .vlans import router as vlans

__all__ = [
    "admin",
    "ai",
    "ansible_defaults",
    "ansible_playbooks",
    "backup",
    "auth",
    "environments",
    "git_repos",
    "git_credentials",
    "global_default_roles",
    "playbook_runs",
    "job_templates",
    "monitoring",
    "vault_credentials",
    "host_statuses",
    "host_types",
    "vlans",
    "roles",
    "role_fields",
    "role_matrix",
    "apps",
    "datastores",
    "domains",
    "k3s_clusters",
    "k3s_cluster_apps",
    "proxmox",
    "unifi",
    "hosts",
    "host_resources",
    "host_storage",
    "host_apps",
    "host_app_fields",
    "host_host_type_fields",
    "host_role_fields",
    "host_ansible_vars",
    "host_status_fields",
    "host_type_fields",
    "host_type_roles",
    "status_fields",
    "app_fields",
    "inventory",
]
