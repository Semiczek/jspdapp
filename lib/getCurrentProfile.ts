import { supabase } from './supabase'

const CLEANING_COMPANY_ID = 'f89e03ab-489b-40ca-a9a6-bed591d23d60'

export async function getCurrentProfile() {
  const { data: userData, error: userError } = await supabase.auth.getUser()

  if (userError || !userData?.user) {
    throw new Error('User not logged in')
  }

  const userId = userData.user.id

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, auth_user_id')
    .eq('auth_user_id', userId)
    .single()

  if (error || !data) {
    throw new Error('Profile not found')
  }

  return {
    profileId: data.id,
    companyId: CLEANING_COMPANY_ID,
    fullName: data.full_name,
  }
}