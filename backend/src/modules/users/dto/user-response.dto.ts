import { User, UserRole } from '../entities/user.entity';

export class UserResponseDto {
  id!: number;
  email!: string;
  fullName!: string;
  role!: UserRole;
  isActive!: boolean;

  static from(u: User): UserResponseDto {
    return {
      id: Number(u.id),
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      isActive: !!u.isActive,
    };
  }
}
