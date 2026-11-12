CREATE POLICY "Users can view their own profile"
ON public.app_users
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
);