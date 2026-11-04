import os

from dotenv import load_dotenv

from supabase import Client, create_client

load_dotenv()


def get_supabase() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_PUBLISHABLE_KEY"]
    if not url:
        print("Supabase URL was not found!")
    elif not key:
        print("Supabase key was not found or ")
    elif not key.startswith("sk-proj-"):
        print(
            "Supabase key was found, but it doesn't start with sk-proj-; "
            "please check you're using the right key"
        )
    else:
        print("Supabase url and Supabase key found")
    return create_client(url, key)
